import { handleChat } from "../handlers/chat.ts";
import { CORS_HEADERS } from "../lib/cors.ts";

export async function responsesHandler(req: Request): Promise<Response> {
  const res = await handleChat(req);
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}
