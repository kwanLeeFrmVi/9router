// Port of src/sse/services/tokenRefresh.js
// Replaced ../../lib/localDb.js → ../db/index
// Replaced ../utils/logger.js → ../lib/logger

import * as log from "../lib/logger.ts";
import { updateProviderConnection } from "../db/index.ts";
import {
  getProjectIdForConnection,
  invalidateProjectId,
  removeConnection,
} from "open-sse/services/projectId.js";
import {
  TOKEN_EXPIRY_BUFFER_MS as BUFFER_MS,
  refreshAccessToken as _refreshAccessToken,
  refreshClaudeOAuthToken as _refreshClaudeOAuthToken,
  refreshGoogleToken as _refreshGoogleToken,
  refreshQwenToken as _refreshQwenToken,
  refreshCodexToken as _refreshCodexToken,
  refreshIflowToken as _refreshIflowToken,
  refreshGitHubToken as _refreshGitHubToken,
  refreshCopilotToken as _refreshCopilotToken,
  getAccessToken as _getAccessToken,
  refreshTokenByProvider as _refreshTokenByProvider,
  formatProviderCredentials as _formatProviderCredentials,
  getAllAccessTokens as _getAllAccessTokens,
  refreshKiroToken as _refreshKiroToken,
} from "open-sse/services/tokenRefresh.js";

export const TOKEN_EXPIRY_BUFFER_MS = BUFFER_MS;

// ─── Re-exports wrapped with local logger ──────────────────────────────────────

export const refreshAccessToken = (provider: string, refreshToken: string, credentials: unknown) =>
  _refreshAccessToken(provider, refreshToken, credentials, log);

export const refreshClaudeOAuthToken = (refreshToken: string) =>
  _refreshClaudeOAuthToken(refreshToken, log);

export const refreshGoogleToken = (refreshToken: string, clientId: string, clientSecret: string) =>
  _refreshGoogleToken(refreshToken, clientId, clientSecret, log);

export const refreshQwenToken = (refreshToken: string) =>
  _refreshQwenToken(refreshToken, log);

export const refreshCodexToken = (refreshToken: string) =>
  _refreshCodexToken(refreshToken, log);

export const refreshIflowToken = (refreshToken: string) =>
  _refreshIflowToken(refreshToken, log);

export const refreshGitHubToken = (refreshToken: string) =>
  _refreshGitHubToken(refreshToken, log);

export const refreshCopilotToken = (githubAccessToken: string) =>
  _refreshCopilotToken(githubAccessToken, log);

export const refreshKiroToken = (refreshToken: string, providerSpecificData: unknown) =>
  _refreshKiroToken(refreshToken, providerSpecificData, log);

export const getAccessToken = (provider: string, credentials: unknown) =>
  _getAccessToken(provider, credentials, log);

export const refreshTokenByProvider = (provider: string, credentials: unknown) =>
  _refreshTokenByProvider(provider, credentials, log);

export const formatProviderCredentials = (provider: string, credentials: unknown) =>
  _formatProviderCredentials(provider, credentials, log);

export const getAllAccessTokens = (userInfo: unknown) =>
  _getAllAccessTokens(userInfo, log);

// ─── Lifecycle hook ────────────────────────────────────────────────────────────

export function releaseConnection(connectionId: string): void {
  if (!connectionId) return;
  removeConnection(connectionId);
  log.debug("TOKEN_REFRESH", "Released connection resources", { connectionId });
}

// ─── Internal helpers ──────────────────────────────────────────────────────────

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

// ─── Local-specific: persist credentials to DB ────────────────────────────────

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

// ─── Local-specific: proactive token refresh ──────────────────────────────────

export async function checkAndRefreshToken(
  provider: string,
  credentials: Record<string, unknown>
): Promise<Record<string, unknown>> {
  let creds = { ...credentials };

  // 1. Regular access-token expiry
  if (creds.expiresAt) {
    const expiresAt = new Date(creds.expiresAt as string).getTime();
    const now       = Date.now();
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
          accessToken:  newCreds.accessToken,
          refreshToken: newCreds.refreshToken ?? creds.refreshToken,
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
  if (provider === "github" && (creds.providerSpecificData as Record<string, unknown> | undefined)?.copilotTokenExpiresAt) {
    const psd = creds.providerSpecificData as Record<string, unknown>;
    const copilotExpiresAt = (psd.copilotTokenExpiresAt as number) * 1000;
    const now              = Date.now();
    const remaining        = copilotExpiresAt - now;

    if (remaining < TOKEN_EXPIRY_BUFFER_MS) {
      log.info("TOKEN_REFRESH", "Copilot token expiring soon, refreshing proactively", {
        provider,
        expiresIn: Math.round(remaining / 1000),
      });

      const copilotToken = await refreshCopilotToken(creds.accessToken as string) as { token: string; expiresAt: number } | null;
      if (copilotToken) {
        const updatedSpecific = {
          ...psd,
          copilotToken:          copilotToken.token,
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
      copilotToken:          copilotToken.token,
      copilotTokenExpiresAt: copilotToken.expiresAt,
    },
  };
}
