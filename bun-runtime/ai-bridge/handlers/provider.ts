// Provider-level helpers: format detection, URL building, header building.
// Written from scratch in TypeScript.

import { FORMATS } from "../translator/formats.ts";

/**
 * Detect source format from request body structure.
 * This is a simplified version of open-sse's detectFormat.
 */
export function detectFormat(body: Record<string, unknown> | null): string {
  if (!body) return FORMATS.OPENAI;

  // OpenAI Responses API: has input (array or string) instead of messages[]
  if (body.input !== undefined && Array.isArray(body.input)) {
    return FORMATS.OPENAI_RESPONSES;
  }

  // Gemini format: has contents array
  if (body.contents && Array.isArray(body.contents)) {
    return FORMATS.GEMINI;
  }

  // OpenAI-specific fields
  if (
    body.stream_options !== undefined ||
    body.response_format !== undefined ||
    body.logprobs !== undefined ||
    body.n !== undefined
  ) {
    return FORMATS.OPENAI;
  }

  // Claude format: has messages with content as array
  if (body.messages && Array.isArray(body.messages)) {
    const firstMsg = body.messages[0] as Record<string, unknown> | undefined;
    if (firstMsg?.content && Array.isArray(firstMsg.content)) {
      const firstContent = (firstMsg.content as Array<Record<string, unknown>>)[0];
      // Claude uses source.type, OpenAI uses image_url.url
      if (firstContent?.type === "text" && !body.model?.toString().includes("/")) {
        if (body.system !== undefined || body.anthropic_version !== undefined) {
          return FORMATS.CLAUDE;
        }
      }
      // Check for Claude image format
      const hasClaudeImage = (firstMsg.content as Array<Record<string, unknown>>).some(
        c => c.type === "image" && (c as Record<string, unknown>).source?.type === "base64"
      );
      if (hasClaudeImage) return FORMATS.CLAUDE;
      // Check for Claude tool format
      const hasClaudeTool = (firstMsg.content as Array<Record<string, unknown>>).some(
        c => c.type === "tool_use" || c.type === "tool_result"
      );
      if (hasClaudeTool) return FORMATS.CLAUDE;
    }
    if (body.system !== undefined || body.anthropic_version !== undefined) {
      return FORMATS.CLAUDE;
    }
  }

  return FORMATS.OPENAI;
}

/**
 * Get target format for a provider.
 */
export function getTargetFormat(provider: string): string {
  switch (provider) {
    case "claude": return FORMATS.CLAUDE;
    case "gemini": case "gemini-cli": return FORMATS.GEMINI;
    case "ollama": return FORMATS.OLLAMA;
    case "antigravity": return FORMATS.ANTIGRAVITY;
    default: return FORMATS.OPENAI;
  }
}

/**
 * Build upstream URL for a provider.
 */
export function buildUpstreamUrl(
  provider: string,
  model: string,
  stream: boolean,
  credentials: Record<string, unknown>
): string | null {
  const psd = credentials.providerSpecificData as Record<string, unknown> | undefined;

  switch (provider) {
    case "openai":
    case "openrouter":
    case "anthropic":
      return "https://api.openai.com/v1/chat/completions";

    case "claude": {
      const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}`;
    }

    case "gemini": {
      const apiKey = credentials.apiKey as string | undefined;
      if (!apiKey) return null;
      const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}&key=${apiKey}`;
    }

    case "gemini-cli":
    case "antigravity": {
      if (!credentials.accessToken) return null;
      const action = stream ? "streamGenerateContent?alt=sse" : "generateContent";
      return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}`;
    }

    case "ollama": {
      const base = (psd?.baseUrl as string | undefined) ?? "http://localhost:11434";
      return `${base.replace(/\/$/, "")}/api/chat`;
    }

    case "kilocode":
    case "kimi-coding":
      return `https://api.kimi.com/coding/v1/messages`;

    default:
      return "https://api.openai.com/v1/chat/completions";
  }
}

/**
 * Build upstream headers for a provider.
 */
export function buildUpstreamHeaders(
  provider: string,
  credentials: Record<string, unknown>
): Record<string, string> {
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };

  const apiKey = credentials.apiKey as string | undefined;
  const accessToken = credentials.accessToken as string | undefined;

  switch (provider) {
    case "openai":
    case "openrouter":
    case "anthropic":
      headers["Authorization"] = `Bearer ${apiKey ?? accessToken ?? ""}`;
      break;

    case "claude": {
      if (apiKey) {
        headers["x-api-key"] = apiKey;
      } else if (accessToken) {
        headers["Authorization"] = `Bearer ${accessToken}`;
      }
      headers["Anthropic-Version"] = "2023-06-01";
      break;
    }

    case "gemini":
      // API key goes in URL query param, not header
      break;

    case "gemini-cli":
    case "antigravity":
      headers["Authorization"] = `Bearer ${accessToken ?? ""}`;
      break;

    default:
      headers["Authorization"] = `Bearer ${apiKey ?? accessToken ?? ""}`;
  }

  return headers;
}
