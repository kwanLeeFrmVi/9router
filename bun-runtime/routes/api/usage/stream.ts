// GET /api/usage/stream — SSE stream of real-time usage events
import { statsEmitter } from "@/lib/usageDb";
import { checkAdminAuth } from "lib/authMiddleware.ts";
import { register } from "lib/routeRegistry";

export async function GET(req: Request): Promise<Response> {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return auth.response;

  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(ctrl) {
      controller = ctrl;

      const send = (event: unknown, eventName: string) => {
        if (!controller) return;
        const payload = `data: ${JSON.stringify(event)}\n\n`;
        try {
          controller.enqueue(new TextEncoder().encode(payload));
        } catch {
          // stream may have been cancelled
        }
      };

      // Heartbeat every 15s to keep connection alive
      const heartbeat = setInterval(() => {
        if (!controller) { clearInterval(heartbeat); return; }
        try {
          controller.enqueue(new TextEncoder().encode(": ping\n\n"));
        } catch {
          clearInterval(heartbeat);
        }
      }, 15_000);

      const listener = (data: unknown) => send(data, "usage");
      statsEmitter.on("usage", listener);

      req.signal.addEventListener("abort", () => {
        clearInterval(heartbeat);
        statsEmitter.off("usage", listener);
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
  return new Response(null, { status: 204, headers: { ...{ "Access-Control-Allow-Origin": "*" } } });
}

register("/api/usage/stream", { GET, OPTIONS });
