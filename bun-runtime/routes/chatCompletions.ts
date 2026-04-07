import { handleChat } from "../handlers/chat.ts";
import { CORS_HEADERS } from "../lib/cors.ts";

export async function chatCompletionsHandler(req: Request): Promise<Response> {
  const res = await handleChat(req);
  // Passthrough: the response from handleChat already streams correctly.
  // Add CORS headers without buffering the body.
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
