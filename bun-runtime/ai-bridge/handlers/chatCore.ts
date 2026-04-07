// Core streaming chat handler — written from scratch in TypeScript.
// Handles the full lifecycle: translate request → upstream fetch → translate response → stream back.

import { FORMATS } from "../translator/formats.ts";
import { Request, NeedsTranslation, ResponseNonStream } from "../translator/index.ts";
import { HTTP_STATUS } from "../config/runtimeConfig.ts";
import { PROVIDER_ID_TO_ALIAS, getModelTargetFormat } from "../config/providerModels.ts";
import { detectFormat, getTargetFormat, buildUpstreamUrl, buildUpstreamHeaders } from "./provider.js";

export interface ChatCoreOptions {
  body: Record<string, unknown>;
  modelInfo: { provider: string; model: string };
  credentials: Record<string, unknown>;
  log?: {
    debug?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
    info?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
    warn?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
    error?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
  };
  clientRawRequest?: { endpoint: string; body: Record<string, unknown>; headers: Record<string, string> };
  connectionId?: string;
  userAgent?: string;
  apiKey?: string | null;
  sourceFormatOverride?: string;
  onCredentialsRefreshed?: (creds: Record<string, unknown>) => Promise<void>;
  onRequestSuccess?: () => Promise<void>;
  onDisconnect?: (reason: string) => void;
}

export interface ChatCoreResult {
  success: boolean;
  response?: Response;
  status?: number;
  error?: string;
}

const STREAM_PROVIDERS = new Set(["openai", "codex"]);

export async function handleChatCore(opts: ChatCoreOptions): Promise<ChatCoreResult> {
  const { body, modelInfo, credentials, log, sourceFormatOverride } = opts;
  const { provider, model } = modelInfo;

  // Detect source format
  const sourceFormat = sourceFormatOverride ?? (body._sourceFormat as string) ?? detectFormat(body);

  // Determine target format
  const alias = PROVIDER_ID_TO_ALIAS[provider] ?? provider;
  const modelTargetFormat = getModelTargetFormat(alias, model);
  const targetFormat = modelTargetFormat ?? getTargetFormat(provider);

  // Determine streaming mode
  const streamProvider = STREAM_PROVIDERS.has(provider);
  const stream = streamProvider ? true : (body.stream !== false);

  log?.debug?.("CHAT", `${sourceFormat} → ${targetFormat} | stream=${stream}`);

  // Translate request body
  const bodyBytes = new TextEncoder().encode(JSON.stringify(body));
  const translatedBytes = NeedsTranslation(sourceFormat, targetFormat)
    ? Request(sourceFormat, targetFormat, model, bodyBytes, stream !== false)
    : bodyBytes;

  const translatedBody = JSON.parse(new TextDecoder().decode(translatedBytes)) as Record<string, unknown>;
  translatedBody.model = model;

  // Build upstream URL and headers
  const upstreamUrl = buildUpstreamUrl(provider, model, stream !== false, credentials);
  if (!upstreamUrl) {
    return { success: false, status: HTTP_STATUS.BAD_REQUEST, error: `Unknown provider: ${provider}` };
  }

  const headers = buildUpstreamHeaders(provider, credentials);

  log?.debug?.("CHAT", `${provider.toUpperCase()} → ${upstreamUrl}`);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: new TextDecoder().decode(translatedBytes),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => "");
      const errResult = handleUpstreamError(upstream.status, errorText);
      if (errResult) return errResult;
    }

    if (stream) {
      const response = await handleStreamingResponse(upstream, sourceFormat, targetFormat, model, translatedBytes, opts);
      opts.onRequestSuccess?.().catch(() => {});
      return { success: true, response };
    } else {
      const responseBody = await upstream.text();
      const translated = NeedsTranslation(targetFormat, sourceFormat)
        ? ResponseNonStream(targetFormat, sourceFormat, null, model, translatedBytes, translatedBytes, new TextEncoder().encode(responseBody))
        : new TextEncoder().encode(responseBody);

      const response = new globalThis.Response(translated, {
        status: upstream.status || 200,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-cache" },
      });

      opts.onRequestSuccess?.().catch(() => {});
      return { success: true, response };
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error?.("CHAT", `Upstream error: ${msg}`);
    return { success: false, status: HTTP_STATUS.BAD_GATEWAY, error: msg };
  }
}

// ─── Streaming response ───────────────────────────────────────────────────────────

async function handleStreamingResponse(
  upstream: Response,
  sourceFormat: string,
  targetFormat: string,
  model: string,
  translatedBytes: Uint8Array,
  opts: ChatCoreOptions
): Promise<Response> {
  if (!upstream.body) {
    return new globalThis.Response("Upstream returned empty body", { status: 502 });
  }

  let state: unknown = undefined;
  const encoder = new TextEncoder();

  const stream = new ReadableStream({
    async start(controller) {
      const reader = upstream.body!.getReader();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          const raw = value instanceof Uint8Array ? value : new Uint8Array(value as ArrayBuffer);
          const translated = translateChunk(sourceFormat, targetFormat, model, translatedBytes, raw, state);
          state = translated.state;

          for (const chunk of translated.chunks) {
            controller.enqueue(chunk);
          }
        }

        // Flush any remaining state (stop events)
        const doneChunks = translateChunk(sourceFormat, targetFormat, model, translatedBytes, encoder.encode("[DONE]"), state);
        for (const chunk of doneChunks.chunks) {
          controller.enqueue(chunk);
        }

        controller.close();
      } catch (streamErr) {
        controller.error(streamErr);
      } finally {
        reader.releaseLock();
      }
    },
    cancel() {
      opts.onDisconnect?.("client_disconnected");
    },
  });

  return new globalThis.Response(stream, {
    status: upstream.status || 200,
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

interface TranslateChunkResult {
  chunks: Uint8Array[];
  state: unknown;
}

function translateChunk(
  sourceFormat: string,
  targetFormat: string,
  model: string,
  requestBytes: Uint8Array,
  raw: Uint8Array,
  state: unknown
): TranslateChunkResult {
  // Import the Response function lazily to avoid circular dependency at module level
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { Response: translate } = require("../translator/index.ts") as { Response: (from: string, to: string, ctx: unknown, modelName: string, origReq: Uint8Array, req: Uint8Array, raw: Uint8Array, state: unknown) => Uint8Array[] };

  const chunks = translate(sourceFormat, targetFormat, null, model, requestBytes, requestBytes, raw, state);
  const newState = chunks.length > 0 ? chunks[chunks.length - 1] : state;
  return { chunks, state: newState };
}

// ─── Error handling ─────────────────────────────────────────────────────────────

function handleUpstreamError(status: number, errorText: string): ChatCoreResult | null {
  if (status === 401 || status === 403) {
    return { success: false, status, error: "Authentication failed" };
  }
  if (status === 429) {
    return { success: false, status, error: `Rate limited: ${errorText}` };
  }
  if (status >= 500) {
    return { success: false, status, error: `Upstream error: ${status}` };
  }
  return null;
}
