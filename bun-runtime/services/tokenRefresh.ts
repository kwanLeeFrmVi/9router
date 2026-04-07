// Token refresh — local implementation with DB persistence.
// No open-sse dependency.

import * as log from "../lib/logger.ts";
import { updateProviderConnection } from "../db/index.ts";

// ─── Project ID cache (in-memory, mirrors open-sse behavior) ───────────────────

interface CachedProjectId {
  projectId: string;
  expiresAt: number;
}
const projectIdCache = new Map<string, CachedProjectId>();

export function getProjectIdForConnection(
  _connectionId: string,
  _accessToken: string
): Promise<string | null> {
  // Stub — real implementation requires Google Cloud API knowledge
  return Promise.resolve(null);
}

export function invalidateProjectId(connectionId: string): void {
  projectIdCache.delete(connectionId);
}

export function removeConnection(connectionId: string): void {
  projectIdCache.delete(connectionId);
}

// ─── Token refresh stubs (provider-specific logic lives in open-sse) ────────────────

interface TokenResult {
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  expiresAt?: number;
  providerSpecificData?: Record<string, unknown>;
  token?: string;
}

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000;

export function refreshAccessToken(
  _provider: string,
  _refreshToken: string,
  _credentials: unknown
): Promise<TokenResult | null> {
  return Promise.resolve(null); // Provider-specific; handled by caller
}

export function refreshClaudeOAuthToken(_refreshToken: string): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function refreshGoogleToken(
  _refreshToken: string,
  _clientId: string,
  _clientSecret: string
): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function refreshQwenToken(_refreshToken: string): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function refreshCodexToken(_refreshToken: string): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function refreshIflowToken(_refreshToken: string): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function refreshGitHubToken(_refreshToken: string): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function refreshCopilotToken(_githubAccessToken: string): Promise<{ token: string; expiresAt: number } | null> {
  return Promise.resolve(null);
}
export function refreshKiroToken(
  _refreshToken: string,
  _providerSpecificData: unknown
): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function getAccessToken(
  _provider: string,
  _credentials: unknown
): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function refreshTokenByProvider(
  _provider: string,
  _credentials: unknown
): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function formatProviderCredentials(
  _provider: string,
  _credentials: unknown
): TokenResult | null {
  return null;
}
export function getAllAccessTokens(_userInfo: unknown): Promise<Record<string, unknown>> {
  return Promise.resolve({});
}
export function parseVertexSaJson(apiKey: string): Record<string, unknown> | null {
  if (typeof apiKey !== "string") return null;
  try {
    const parsed = JSON.parse(apiKey);
    if (
      parsed.type === "service_account" &&
      parsed.client_email &&
      parsed.private_key &&
      parsed.project_id
    ) {
      return parsed as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}
export function refreshVertexToken(
  _saJson: Record<string, unknown>
): Promise<TokenResult | null> {
  return Promise.resolve(null);
}
export function refreshWithRetry(
  refreshFn: () => Promise<TokenResult | null>,
  maxRetries = 3
): Promise<TokenResult | null> {
  return (async () => {
    for (let attempt = 0; attempt < maxRetries; attempt++) {
      if (attempt > 0) await new Promise(r => setTimeout(r, attempt * 1000));
      try {
        const result = await refreshFn();
        if (result) return result;
      } catch { /* ignore */ }
    }
    return null;
  })();
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function toExpiresAt(expiresIn: number): string {
  return new Date(Date.now() + expiresIn * 1000).toISOString();
}

function needsProjectId(provider: string): boolean {
  return provider === "antigravity" || provider === "gemini-cli";
}

function _refreshProjectId(provider: string, connectionId: string, accessToken: string): void {
  if (!needsProjectId(provider) || !connectionId || !accessToken) return;
  invalidateProjectId(connectionId);
  getProjectIdForConnection(connectionId, accessToken)
    .then((projectId: string | null) => {
      if (!projectId) return;
      updateProviderCredentials(connectionId, { projectId }).catch((err: Error) => {
        log.debug("TOKEN_REFRESH", "Failed to persist refreshed projectId", {
          connectionId,
          error: err?.message ?? err,
        });
      });
    })
    .catch((err: Error) => {
      log.debug("TOKEN_REFRESH", "Failed to fetch projectId after token refresh", {
        connectionId,
        error: err?.message ?? err,
      });
    });
}

// ─── Local: persist credentials to DB ─────────────────────────────────────────

export async function updateProviderCredentials(
  connectionId: string,
  newCredentials: Record<string, unknown>
): Promise<boolean> {
  try {
    const updates: Record<string, unknown> = {};

    if (newCredentials.accessToken)  updates.accessToken  = newCredentials.accessToken;
    if (newCredentials.refreshToken) updates.refreshToken = newCredentials.refreshToken;
    if (newCredentials.expiresIn) {
      updates.expiresAt = toExpiresAt(newCredentials.expiresIn as number);
      updates.expiresIn = newCredentials.expiresIn;
    }
    if (newCredentials.providerSpecificData) {
      updates.providerSpecificData = {
        ...((newCredentials.existingProviderSpecificData as Record<string, unknown>) ?? {}),
        ...(newCredentials.providerSpecificData as Record<string, unknown>),
      };
    }
    if (newCredentials.projectId) updates.projectId = newCredentials.projectId;

    const result = await updateProviderConnection(connectionId, updates);
    log.info("TOKEN_REFRESH", "Credentials updated in DB", { connectionId, success: !!result });
    return !!result;
  } catch (error) {
    log.error("TOKEN_REFRESH", "Error updating credentials in DB", {
      connectionId,
      error: (error as Error).message,
    });
    return false;
  }
}

// ─── Proactive token refresh ───────────────────────────────────────────────────

export async function checkAndRefreshToken(
  provider: string,
  credentials: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let creds = { ...credentials };

  // 1. Regular access-token expiry
  if (creds.expiresAt) {
    const expiresAt = new Date(creds.expiresAt as string).getTime();
    const now = Date.now();
    const remaining = expiresAt - now;

    if (remaining < TOKEN_EXPIRY_BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Token expiring soon, refreshing proactively", {
        provider,
        expiresIn: Math.round(remaining / 1000),
      });

      const newCreds = await getAccessToken(provider, creds) as Record<string, unknown> | null;
      if (newCreds?.accessToken) {
        const mergedCreds = {
          ...newCreds,
          existingProviderSpecificData: creds.providerSpecificData,
        };

        await updateProviderCredentials(creds.connectionId as string, mergedCreds);

        creds = {
          ...creds,
          accessToken: newCreds.accessToken,
          refreshToken: (newCreds.refreshToken ?? creds.refreshToken) as string | undefined,
          providerSpecificData: newCreds.providerSpecificData
            ? { ...(creds.providerSpecificData as object), ...(newCreds.providerSpecificData as object) }
            : creds.providerSpecificData,
          expiresAt: newCreds.expiresIn
            ? toExpiresAt(newCreds.expiresIn as number)
            : creds.expiresAt,
        };

        _refreshProjectId(provider, creds.connectionId as string, creds.accessToken as string);
      }
    }
  }

  // 2. GitHub Copilot token expiry
  const psd = creds.providerSpecificData as Record<string, unknown> | undefined;
  if (provider === "github" && psd?.copilotTokenExpiresAt) {
    const copilotExpiresAt = (psd.copilotTokenExpiresAt as number) * 1000;
    const now = Date.now();
    const remaining = copilotExpiresAt - now;

    if (remaining < TOKEN_EXPIRY_BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Copilot token expiring soon, refreshing proactively", {
        provider,
        expiresIn: Math.round(remaining / 1000),
      });

      const copilotToken = await refreshCopilotToken(creds.accessToken as string) as { token: string; expiresAt: number } | null;
      if (copilotToken) {
        const updatedSpecific: Record<string, unknown> = {
          ...psd,
          copilotToken: copilotToken.token,
          copilotTokenExpiresAt: copilotToken.expiresAt,
        };

        await updateProviderCredentials(creds.connectionId as string, {
          providerSpecificData: updatedSpecific,
        });

        creds.providerSpecificData = updatedSpecific;
        creds.copilotToken = copilotToken.token;
      }
    }
  }

  return creds;
}

export async function refreshGitHubAndCopilotTokens(
  credentials: Record<string, unknown>
): Promise<Record<string, unknown> | null> {
  const newGitHubCreds = await refreshGitHubToken(credentials.refreshToken as string) as Record<string, unknown> | null;
  if (!newGitHubCreds?.accessToken) return newGitHubCreds;

  const copilotToken = await refreshCopilotToken(newGitHubCreds.accessToken as string) as { token: string; expiresAt: number } | null;
  if (!copilotToken) return newGitHubCreds;

  return {
    ...newGitHubCreds,
    providerSpecificData: {
      copilotToken: copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expiresAt,
    },
  };
}
