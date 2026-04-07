// Port of src/app/api/v1/messages/count_tokens/route.js
import { CORS_HEADERS } from "../lib/cors.ts";

export async function countTokensHandler(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS },
    });
  }

  const messages = (body.messages as Array<{ content: unknown }>) ?? [];
  let totalChars = 0;
  for (const msg of messages) {
    if (typeof msg.content === "string") {
      totalChars += msg.content.length;
    } else if (Array.isArray(msg.content)) {
      for (const part of msg.content as Array<{ type: string; text?: string }>) {
        if (part.type === "text" && part.text) {
          totalChars += part.text.length;
        }
      }
    }
  }

  const inputTokens = Math.ceil(totalChars / 4);

  return new Response(JSON.stringify({ input_tokens: inputTokens }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
