// Bun runtime entry point for 9router v1 API endpoints
// Must patch global fetch first (open-sse proxy support)
import "open-sse/index.js";

import { initTranslators } from "open-sse/translator/index.js";
import { openDb } from "./db/index.ts";
import { initConsoleLogCapture } from "./lib/consoleLogBuffer.ts";
import { corsResponse } from "./lib/cors.ts";
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

// Initialize DB (creates tables, opens WAL connection)
openDb();

// Capture server-side console logs for the dashboard log panel
initConsoleLogCapture();

// Initialize translators once at boot
await initTranslators();
console.log("[BUN] Translators initialized");

// Recursively import all routes/**/*.ts to trigger their register() calls
async function loadAllRoutes(dir: string): Promise<void> {
  const entries = readdirSync(dir);
  for (const entry of entries) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      await loadAllRoutes(full);
    } else if (entry === "index.ts" || entry === "index.tsx") {
      await import(`file://${full}`);
    }
  }
}

const PORT = parseInt(process.env.PORT ?? "20129");
const isLinux = process.platform === "linux";

// Load all route files so they self-register, then build the routes config
await loadAllRoutes(join(process.cwd(), "routes"));

const { buildRoutes } = await import("./lib/routeRegistry.ts");
const routes = buildRoutes();

const server = Bun.serve({
  port: PORT,
  reusePort: isLinux, // SO_REUSEPORT: Linux only, enables multi-process clustering
  routes,

  fetch(req) {
    if (req.method === "OPTIONS") return corsResponse();
    return new Response("Not found", { status: 404 });
  },
});

console.log(`[BUN] Listening on port ${server.port}`);
