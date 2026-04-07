// GET /api/console-logs/stream — SSE stream of live console logs
import { getConsoleEmitter, getConsoleLogs } from "lib/consoleLogBuffer.ts";
import { checkAdminAuth } from "lib/authMiddleware.ts";
import { register } from "lib/routeRegistry";
import type { ConsoleLogEntry } from "lib/consoleLogBuffer.ts";

export async function GET(req: Request): Promise<Response> {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return auth.response;

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  const emitter = getConsoleEmitter();

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;

      // Send current buffer first
      for (const entry of getConsoleLogs()) {
        const payload = `data: ${JSON.stringify(entry)}\n\n`;
        try {
          controller.enqueue(new TextEncoder().encode(payload));
        } catch { break; }
      }

      const heartbeat = setInterval(() => {
        if (!controller) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(new TextEncoder().encode(": ping\n\n"));
        } catch { clearInterval(heartbeat); }
      }, 15_000);

      const onLine = (entry: ConsoleLogEntry) => {
        if (!controller) return;
        const payload = `data: ${JSON.stringify(entry)}\n\n`;
        try { controller.enqueue(new TextEncoder().encode(payload)); } catch { /* closed */ }
      };

      const onClear = () => {
        if (!controller) return;
        const payload = `data: ${JSON.stringify({ type: "clear" })}\n\n`;
        try { controller.enqueue(new TextEncoder().encode(payload)); } catch { /* closed */ }
      };

      emitter.on("line", onLine);
      emitter.on("clear", onClear);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        emitter.off("line", onLine);
        emitter.off("clear", onClear);
        controller?.close();
      });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type":  "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection":    "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } });
}

register("/api/console-logs/stream", { GET, OPTIONS });
