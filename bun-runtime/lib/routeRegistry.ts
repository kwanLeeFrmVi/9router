/**
 * Central route registry.
 * Route files call `register(routePath, handlers)` to self-register.
 * This avoids dynamic imports and ensures relative paths resolve from the file's own directory.
 */
import { corsResponse } from "./cors.ts";

const HTTP_METHODS = ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"] as const;
type HttpMethod = typeof HTTP_METHODS[number];
type Handler = (req: Request) => Response | Promise<Response>;

type RouteConfig = Record<string, Partial<Record<HttpMethod, Handler>>>;

const registry = new Map<string, Partial<Record<HttpMethod, Handler>>>();

export function register(path: string, handlers: Partial<Record<HttpMethod, Handler>>): void {
  // Auto-inject OPTIONS if not explicitly exported
  const entry = { ...handlers };
  if (!entry.OPTIONS) {
    entry.OPTIONS = corsResponse;
  }
  registry.set(path, entry);
}

/**
 * Returns the built route config and clears the registry.
 * Safe to call multiple times (re-builds from whatever has been registered so far).
 */
export function buildRoutes(): RouteConfig {
  console.log(`[routeLoader] Discovered ${registry.size} routes`);
  for (const [path, methods] of [...registry.entries()].sort()) {
    console.log(`  ${path}: ${Object.keys(methods).join(", ")}`);
  }

  // Return current snapshot and keep registry for subsequent builds
  return Object.fromEntries(
    [...registry.entries()].sort(([a], [b]) => a.localeCompare(b))
  );
}
