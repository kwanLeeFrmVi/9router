// Core embeddings handler — written from scratch in TypeScript.

import { HTTP_STATUS } from "../config/runtimeConfig.ts";

export interface EmbeddingsCoreOptions {
  body: Record<string, unknown>;
  modelInfo: { provider: string; model: string };
  credentials: Record<string, unknown>;
  log?: {
    debug?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
    info?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
    warn?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
    error?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
  };
  onCredentialsRefreshed?: (creds: Record<string, unknown>) => Promise<void>;
  onRequestSuccess?: () => Promise<void>;
}

export interface EmbeddingsCoreResult {
  success: boolean;
  response?: Response;
  status?: number;
  error?: string;
}

export async function handleEmbeddingsCore(opts: EmbeddingsCoreOptions): Promise<EmbeddingsCoreResult> {
  const { body, modelInfo, credentials, log } = opts;
  const { provider, model } = modelInfo;

  // ── Input validation ─────────────────────────────────────────────────────────
  const input = body.input;
  if (!input || typeof input !== "string" && !Array.isArray(input)) {
    return { success: false, status: HTTP_STATUS.BAD_REQUEST, error: "Missing required field: input (must be string or array)" };
  }

  // Build upstream URL
  const upstreamUrl = buildEmbeddingsUrl(provider, model);
  if (!upstreamUrl) {
    return { success: false, status: HTTP_STATUS.BAD_REQUEST, error: `Unknown embeddings provider: ${provider}` };
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "Authorization": `Bearer ${credentials.apiKey ?? credentials.accessToken ?? ""}`,
  };

  log?.debug?.("EMBED", `${provider} → ${upstreamUrl}`);

  try {
    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...body, model }),
    });

    if (!upstream.ok) {
      const errorText = await upstream.text().catch(() => "");
      log?.error?.("EMBED", `Upstream error ${upstream.status}: ${errorText}`);
      return { success: false, status: upstream.status, error: errorText };
    }

    const responseBody = await upstream.text();
    try {
      JSON.parse(responseBody);
    } catch {
      log?.error?.("EMBED", "Provider response is not valid JSON");
      return { success: false, status: HTTP_STATUS.BAD_GATEWAY, error: "Provider response is not valid JSON" };
    }
    const response = new globalThis.Response(responseBody, {
      status: upstream.status || 200,
      headers: { "Content-Type": "application/json" },
    });

    opts.onRequestSuccess?.().catch(() => {});
    return { success: true, response };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log?.error?.("EMBED", `Fetch error: ${msg}`);
    return { success: false, status: HTTP_STATUS.BAD_GATEWAY, error: msg };
  }
}

function buildEmbeddingsUrl(provider: string, _model: string): string | null {
  switch (provider) {
    case "openai":
    case "openrouter":
      return "https://api.openai.com/v1/embeddings";
    case "anthropic":
      return "https://api.anthropic.com/v1/embeddings";
    case "gemini": {
      const apiKey = _model; // model field used as apiKey for gemini
      return `https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=${apiKey}`;
    }
    case "cohere":
      return "https://api.cohere.ai/v1/embed";
    default:
      return "https://api.openai.com/v1/embeddings";
  }
}
