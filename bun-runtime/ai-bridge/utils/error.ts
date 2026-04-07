import { ERROR_TYPES, DEFAULT_ERROR_MESSAGES } from "../config/runtimeConfig.ts";

// ─── Core builders ─────────────────────────────────────────────────────────────

export function buildErrorBody(statusCode: number, message?: string): object {
  const info = ERROR_TYPES[statusCode] ?? (
    statusCode >= 500
      ? { type: "server_error", code: "internal_server_error" }
      : { type: "invalid_request_error", code: "" }
  );
  return {
    error: {
      message: message ?? DEFAULT_ERROR_MESSAGES[statusCode] ?? "An error occurred",
      type: info.type,
      code: info.code,
    },
  };
}

export function errorResponse(statusCode: number, message?: string): Response {
  return new Response(JSON.stringify(buildErrorBody(statusCode, message)), {
    status: statusCode,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" },
  });
}

export function unavailableResponse(
  statusCode: number,
  message: string,
  retryAfter: string,
  retryAfterHuman: string
): Response {
  const retryAfterSec = Math.max(
    Math.ceil((new Date(retryAfter).getTime() - Date.now()) / 1000),
    1
  );
  return new Response(
    JSON.stringify({ error: { message: `${message} (${retryAfterHuman})` } }),
    {
      status: statusCode,
      headers: { "Content-Type": "application/json", "Retry-After": String(retryAfterSec) },
    }
  );
}

// ─── Error result object for chatCore ─────────────────────────────────────────

export interface ErrorResult {
  success: false;
  status: number;
  error: string;
  response: Response;
  retryAfterMs?: number;
}

export function createErrorResult(
  statusCode: number,
  message: string,
  retryAfterMs?: number
): ErrorResult {
  const result: ErrorResult = {
    success: false,
    status: statusCode,
    error: message,
    response: errorResponse(statusCode, message),
  };
  if (retryAfterMs) result.retryAfterMs = retryAfterMs;
  return result;
}

// ─── Antigravity-specific helpers ──────────────────────────────────────────────

/**
 * Parse Antigravity 429 error message to extract retry time.
 * Example: "You have exhausted your capacity on this model. Your quota will reset after 2h7m23s."
 */
export function parseAntigravityRetryTime(message: string): number | null {
  const match = message.match(/reset after (\d+h)?(\d+m)?(\d+s)?/i);
  if (!match) return null;
  let totalMs = 0;
  if (match[1]) totalMs += parseInt(match[1]) * 60 * 60 * 1000;
  if (match[2]) totalMs += parseInt(match[2]) * 60 * 1000;
  if (match[3]) totalMs += parseInt(match[3]) * 1000;
  return totalMs > 0 ? totalMs : null;
}

export async function parseUpstreamError(
  response: Response,
  provider?: string | null
): Promise<{ statusCode: number; message: string; retryAfterMs: number | null }> {
  let message = "";
  let retryAfterMs: number | null = null;

  try {
    const text = await response.text();
    try {
      const json = JSON.parse(text);
      message = json.error?.message || json.message || json.error || text;
    } catch {
      message = text;
    }
  } catch {
    message = `Upstream error: ${response.status}`;
  }

  const messageStr = typeof message === "string" ? message : JSON.stringify(message);
  const finalMessage =
    messageStr ||
    DEFAULT_ERROR_MESSAGES[response.status] ||
    `Upstream error: ${response.status}`;

  if (provider === "antigravity" && response.status === 429) {
    retryAfterMs = parseAntigravityRetryTime(finalMessage);
  }

  return { statusCode: response.status, message: finalMessage, retryAfterMs };
}

export function formatProviderError(
  error: { message?: string; code?: string },
  _provider: string,
  _model: string,
  statusCode?: number | string
): string {
  const code = statusCode || (error as { code?: string }).code || "FETCH_FAILED";
  return `[${code}]: ${error.message || "Unknown error"}`;
}