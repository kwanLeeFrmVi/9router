// Port of src/app/api/v1/api/chat/route.js
import { handleChat } from "../../../../handlers/chat.ts";
import { transformToOllama } from "open-sse/utils/ollamaTransform.js";

import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }

  const modelName = (body.model as string | undefined) ?? "llama3.2";
  const streamingBody = { ...body, stream: true };

  const internalReq = new Request(req.url, {
    method: "POST",
    headers: req.headers,
    body: JSON.stringify(streamingBody),
  });

  const response = await handleChat(internalReq);
  const ollamaRes = await transformToOllama(response, modelName) as Response;

  const headers = new Headers(ollamaRes.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(ollamaRes.body, { status: ollamaRes.status, statusText: ollamaRes.statusText, headers });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/v1/api/chat", { POST, OPTIONS });
