// Token refresh utilities for OAuth providers.
// Written from scratch in TypeScript.

export { TOKEN_EXPIRY_BUFFER_MS } from "../config/runtimeConfig.ts";

interface TokenResult {
  accessToken: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: number;
  providerSpecificData?: Record<string, unknown>;
}

interface Log {
  debug?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
  info?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
  warn?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
  error?: (ctx: string, msg: string, data?: Record<string, unknown>) => void;
}

// ─── Provider config stubs (replaced by bun-runtime's providers.ts) ───────────────

// These are placeholder configs — the actual values come from bun-runtime/providers.ts
// This file re-exports the refresh functions that are used by handlers

export async function refreshAccessToken(
  _provider: string,
  _refreshToken: string,
  _credentials: Record<string, unknown>,
  _log: Log | null
): Promise<TokenResult | null> {
  return null; // Handled by bun-runtime's providers.ts
}

export async function refreshClaudeOAuthToken(
  _refreshToken: string,
  _log: Log | null
): Promise<TokenResult | null> {
  return null;
}

export async function refreshGoogleToken(
  _refreshToken: string,
  _clientId: string,
  _clientSecret: string,
  _log: Log | null
): Promise<TokenResult | null> {
  return null;
}

export async function refreshQwenToken(
  _refreshToken: string,
  _log: Log | null
): Promise<TokenResult | null> {
  return null;
}

export async function refreshCodexToken(
  _refreshToken: string,
  _log: Log | null
): Promise<TokenResult | null> {
  return null;
}

export async function refreshIflowToken(
  _refreshToken: string,
  _log: Log | null
): Promise<TokenResult | null> {
  return null;
}

export async function refreshGitHubToken(
  _refreshToken: string,
  _log: Log | null
): Promise<TokenResult | null> {
  return null;
}

export async function refreshCopilotToken(
  _githubAccessToken: string,
  _log: Log | null
): Promise<{ token: string; expiresAt: string } | null> {
  return null;
}

export async function getAccessToken(
  _provider: string,
  _credentials: Record<string, unknown>,
  _log: Log | null
): Promise<TokenResult | null> {
  return null;
}

export async function refreshTokenByProvider(
  _provider: string,
  _credentials: Record<string, unknown>,
  _log: Log | null
): Promise<TokenResult | null> {
  return null;
}

export function parseVertexSaJson(apiKey: string): Record<string, unknown> | null {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (parsed.type === "service_account" && parsed.client_email && parsed.private_key && parsed.project_id) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

export async function refreshVertexToken(
  _saJson: Record<string, unknown>,
  _log: Log | null
): Promise<TokenResult | null> {
  return null;
}

export async function refreshWithRetry(
  refreshFn: () => Promise<TokenResult | null>,
  maxRetries = 3,
  _log: Log | null = null
): Promise<TokenResult | null> {
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1000));
    try {
      const result = await refreshFn();
      if (result) return result;
    } catch { /* ignore */ }
  }
  return null;
}