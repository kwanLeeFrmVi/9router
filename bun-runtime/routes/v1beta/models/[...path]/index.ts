// Port of src/app/api/v1beta/models/[...path]/route.js
import { handleChat } from "handlers/chat.ts";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

const FINISH_REASON_MAP: Record<string, string> = {
  stop: "STOP",
  length: "MAX_TOKENS",
  tool_calls: "STOP",
  content_filter: "SAFETY",
};

function convertGeminiToInternal(
  geminiBody: Record<string, unknown>,
  model: string,
  stream: boolean
): Record<string, unknown> {
  const messages: Array<{ role: string; content: string }> = [];

  const systemInstruction = geminiBody.systemInstruction as { parts?: Array<{ text?: string }> } | undefined;
  if (systemInstruction) {
    const systemText = systemInstruction.parts?.map(p => p.text).join("\n") ?? "";
    if (systemText) messages.push({ role: "system", content: systemText });
  }

  const contents = geminiBody.contents as Array<{ role?: string; parts?: Array<{ text?: string }> }> | undefined;
  if (contents) {
    for (const content of contents) {
      const role = content.role === "model" ? "assistant" : "user";
      const text = content.parts?.map(p => p.text).join("\n") ?? "";
      messages.push({ role, content: text });
    }
  }

  const generationConfig = geminiBody.generationConfig as Record<string, unknown> | undefined;
  return { model, messages, stream, max_tokens: generationConfig?.maxOutputTokens, temperature: generationConfig?.temperature, top_p: generationConfig?.topP };
}

function transformOpenAISSEToGeminiSSE(upstreamResponse: Response, model: string): Response {
  if (!upstreamResponse.ok || !upstreamResponse.body) return upstreamResponse;

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();

  const transformStream = new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      const text = decoder.decode(chunk, { stream: true });
      for (const line of text.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const data = line.slice(5).trim();
        if (!data || data === "[DONE]") continue;

        let parsed: Record<string, unknown>;
        try { parsed = JSON.parse(data) as Record<string, unknown>; } catch { continue; }

        const choices = parsed.choices as Array<{ delta?: { content?: string; reasoning_content?: string }; finish_reason?: string }> | undefined;
        const choice = choices?.[0];
        if (!choice) continue;

        const parts: Array<{ text: string; thought?: boolean }> = [];
        if (choice.delta?.reasoning_content) parts.push({ text: choice.delta.reasoning_content, thought: true });
        if (choice.delta?.content) parts.push({ text: choice.delta.content });

        if (parts.length === 0 && !choice.finish_reason) continue;

        const candidate: Record<string, unknown> = { content: { role: "model", parts: parts.length > 0 ? parts : [{ text: "" }] }, index: 0 };
        if (choice.finish_reason) candidate.finishReason = FINISH_REASON_MAP[choice.finish_reason] ?? "STOP";

        const geminiChunk: Record<string, unknown> = { candidates: [candidate] };
        if (choice.finish_reason && parsed.usage) {
          const usage = parsed.usage as Record<string, number>;
          geminiChunk.usageMetadata = {
            promptTokenCount: usage.prompt_tokens ?? 0,
            candidatesTokenCount: usage.completion_tokens ?? 0,
            totalTokenCount: usage.total_tokens ?? 0,
          };
          const details = (parsed.usage as Record<string, Record<string, number> | undefined>).completion_tokens_details;
          if (details?.reasoning_tokens) {
            (geminiChunk.usageMetadata as Record<string, unknown>).thoughtsTokenCount = details.reasoning_tokens;
          }
          geminiChunk.modelVersion = parsed.model ?? model;
        }

        controller.enqueue(encoder.encode("data: " + JSON.stringify(geminiChunk) + "\r\n\r\n"));
      }
    },
  });

  return new Response(upstreamResponse.body.pipeThrough(transformStream), {
    status: 200,
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", ...CORS_HEADERS },
  });
}

async function convertOpenAIResponseToGemini(response: Response, model: string): Promise<Response> {
  if (!response.ok) return response;
  let body: Record<string, unknown>;
  try { body = await response.json() as Record<string, unknown>; } catch { return response; }
  if (body.candidates) return Response.json(body, { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
  if (body.error) return Response.json(body, { status: response.status, headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

  const choices = body.choices as Array<{ message?: { content?: string; reasoning_content?: string }; finish_reason?: string }> | undefined;
  const choice = choices?.[0];
  if (!choice) return Response.json(body, { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });

  const { message, finish_reason } = choice;
  const parts: Array<{ text: string; thought?: boolean }> = [];
  if (message?.reasoning_content) parts.push({ text: message.reasoning_content, thought: true });
  parts.push({ text: message?.content ?? "" });

  const geminiResponse: Record<string, unknown> = {
    candidates: [{ content: { role: "model", parts }, finishReason: FINISH_REASON_MAP[finish_reason ?? ""] ?? "STOP", index: 0 }],
    modelVersion: body.model ?? model,
  };
  if (body.usage) {
    const usage = body.usage as Record<string, number>;
    geminiResponse.usageMetadata = {
      promptTokenCount: usage.prompt_tokens ?? 0,
      candidatesTokenCount: usage.completion_tokens ?? 0,
      totalTokenCount: usage.total_tokens ?? 0,
    };
    const details = (body.usage as Record<string, Record<string, number> | undefined>).completion_tokens_details;
    if (details?.reasoning_tokens) {
      (geminiResponse.usageMetadata as Record<string, unknown>).thoughtsTokenCount = details.reasoning_tokens;
    }
  }
  return Response.json(geminiResponse, { headers: { "Content-Type": "application/json", ...CORS_HEADERS } });
}

export async function POST(req: Request): Promise<Response> {
  try {
    const params = (req as unknown as { params?: Record<string, string> }).params;
    const pathStr = params?.["*"] ?? new URL(req.url).pathname.replace(/^\/v1beta\/models\//, "");
    const colonIdx = pathStr.lastIndexOf(":");
    const model = colonIdx >= 0 ? pathStr.slice(0, colonIdx) : pathStr;
    const stream = colonIdx >= 0 && pathStr.slice(colonIdx) === ":streamGenerateContent";

    const body = await req.json() as Record<string, unknown>;
    const convertedBody = convertGeminiToInternal(body, model, stream);

    const newRequest = new Request(req.url, {
      method: "POST",
      headers: req.headers,
      body: JSON.stringify(convertedBody),
    });

    const response = await handleChat(newRequest);
    return stream ? transformOpenAISSEToGeminiSSE(response, model) : convertOpenAIResponseToGemini(response, model);
  } catch (error) {
    console.log("Error handling Gemini request:", error);
    return Response.json({ error: { message: (error as Error).message, code: 500 } }, { status: 500 });
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/v1beta/models/*", { POST, OPTIONS });
