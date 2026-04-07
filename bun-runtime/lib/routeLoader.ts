import { readdirSync, statSync } from "node:fs";
import { join, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { corsResponse } from "./cors.ts";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as const;
type HttpMethod = typeof HTTP_METHODS[number];

type Handler = (req: Request) => Response | Promise<Response>;
type RouteConfig = Record<string, Partial<Record<HttpMethod, Handler>>>;

/**
 * Normalizes a file path segment into a route pattern segment.
 * Converts Next.js-style dynamic route syntax to standard route pattern syntax.
 *
 * @param segment - The file path segment to normalize
 * @returns The normalized route pattern segment
 *
 * @example
 * normalizeSegment("[id]")      // ":id"
 * normalizeSegment("[...path]") // "*"
 * normalizeSegment("users")     // "users"
 */
function normalizeSegment(segment: string): string {
  // [...path] → * (catch-all)
  if (segment.startsWith("...")) return "*";
  // [param] → :param
  if (segment.startsWith("[")) return ":" + segment.replace(/^\[|\]$/g, "");
  return segment;
}

/**
 * Converts a file path to a route pattern string.
 * Handles relative path calculation, extension removal, and segment normalization.
 *
 * @param filePath - The absolute or relative path to the route file
 * @param routesDir - The base routes directory path
 * @returns The normalized route pattern string (e.g., "/v1/chat/completions")
 *
 * @example
 * pathToRoute("/app/routes/v1/chat/index.ts", "/app/routes")
 * // Returns "/v1/chat"
 */
function pathToRoute(filePath: string, routesDir: string): string {
  const rel = relative(routesDir, filePath);
  const withoutExt = rel.replace(/\.ts$/, "").replace(/\.tsx$/, "");
  const segments = withoutExt.split(/[/\\]/);
  // Drop the "index" suffix — e.g. routes/v1/chat/completions/index.ts → v1/chat/completions
  const routeParts = segments
    .slice(0, -1)
    .map(normalizeSegment)
    .filter(Boolean);
  const route = "/" + routeParts.join("/");
  return route === "/index" ? "/" : route;
}

/**
 * Recursively collects all route files (index.ts/index.tsx) from a directory.
 * Only files named "index.ts" or "index.tsx" are considered route handlers.
 *
 * @param dir - The directory to scan for route files
 * @param base - The base path for relative path calculation (used internally for recursion)
 * @returns An array of absolute file paths to route handler files
 *
 * @example
 * collectRouteFiles("./routes")
 * // Returns ["/app/routes/v1/chat/index.ts", "/app/routes/v1/models/index.ts", ...]
 */
function collectRouteFiles(dir: string, base = ""): string[] {
  const results: string[] = [];
  try {
    const entries = readdirSync(dir);
    for (const entry of entries) {
      const full = join(dir, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        results.push(...collectRouteFiles(full, join(base, entry)));
      } else if (
        (entry === "index.ts" || entry === "index.tsx") &&
        dir !== base
      ) {
        results.push(full);
      }
    }
  } catch {
    // dir doesn't exist
  }
  return results;
}

/**
 * Loads all routes from the routes directory and returns a route configuration object.
 *
 * This function:
 * 1. Scans the "routes" directory for index.ts/index.tsx files
 * 2. Dynamically imports each route module using its absolute path (so relative imports resolve correctly)
 * 3. Extracts HTTP method handlers (GET, POST, PUT, DELETE, PATCH, OPTIONS)
 * 4. Auto-injects CORS OPTIONS handler if not explicitly defined
 * 5. Logs discovered routes to console
 *
 * @returns A promise resolving to a RouteConfig object mapping route paths to handlers
 *
 * @example
 * const routes = await loadRoutes();
 * // { "/v1/chat/completions": { POST: handler, OPTIONS: corsHandler }, ... }
 */
export async function loadRoutes(): Promise<RouteConfig> {
  // Resolve routes/ directory relative to this file's location, not process.cwd()
  const loaderDir = dirname(fileURLToPath(import.meta.url));
  const routesDir = join(loaderDir, "..", "routes");
  const filePaths = collectRouteFiles(routesDir);
  const config: RouteConfig = {};

  for (const filePath of filePaths) {
    const routePath = pathToRoute(filePath, routesDir);
    if (!routePath || routePath === "/") continue;

    // Use ?raw + type:module so Bun resolves the module from the file's own directory,
    // ensuring relative imports (../../handlers, ../../lib, etc.) resolve correctly.
    const fileUrl = `file://${filePath}`;
    const mod = await import(fileUrl);
    const handlers = mod.default ?? mod;

    const routeHandlers: Partial<Record<HttpMethod, Handler>> = {};

    for (const method of HTTP_METHODS) {
      const handler = handlers[method] as Handler | undefined;
      if (handler) {
        routeHandlers[method] = handler;
      }
    }

    // Auto-inject OPTIONS if not explicitly exported
    if (!routeHandlers.OPTIONS) {
      routeHandlers.OPTIONS = corsResponse;
    }

    if (Object.keys(routeHandlers).length > 0) {
      config[routePath] = routeHandlers;
    }
  }

  console.log(`[routeLoader] Discovered ${Object.keys(config).length} routes`);
  for (const [path, methods] of Object.entries(config).sort()) {
    console.log(`  ${path}: ${Object.keys(methods).join(", ")}`);
  }

  return config;
}
