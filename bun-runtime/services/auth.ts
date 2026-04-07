// Port of src/sse/services/auth.js
// Replaced @/lib/localDb → ../db/index
// Replaced @/lib/network/connectionProxy → ../lib/connectionProxy
// Replaced @/shared/constants/providers.js → ../lib/providers

import { getProviderConnections, updateProviderConnection, validateApiKey } from "../db/index.ts";
import { resolveConnectionProxyConfig } from "../lib/connectionProxy.ts";
import { resolveProviderId } from "../lib/providers.ts";
import {
  formatRetryAfter,
  checkFallbackError,
  isModelLockActive,
  buildModelLockUpdate,
  getEarliestModelLockUntil,
} from "../ai-bridge/services/auth.ts";
import * as log from "../lib/logger.ts";

// Mutex to prevent race conditions during account selection
let selectionMutex = Promise.resolve();

/**
 * Get provider credentials from DB.
 * Filters out unavailable accounts and returns selected account based on strategy.
 */
export async function getProviderCredentials(
  provider: string,
  excludeConnectionIds: Set<string> | string | null = null,
  model: string | null = null
): Promise<Record<string, unknown> | null> {
  const excludeSet: Set<string> =
    excludeConnectionIds instanceof Set
      ? excludeConnectionIds
      : excludeConnectionIds
      ? new Set([excludeConnectionIds])
      : new Set();

  const currentMutex = selectionMutex;
  let resolveMutex: () => void;
  selectionMutex = new Promise<void>(resolve => { resolveMutex = resolve; });

  try {
    await currentMutex;

    const providerId = resolveProviderId(provider);
    const connections = await getProviderConnections({ provider: providerId, isActive: true });

    log.debug("AUTH", `${provider} | total connections: ${connections.length}, excludeIds: ${excludeSet.size > 0 ? [...excludeSet].join(",") : "none"}, model: ${model ?? "any"}`);

    if (connections.length === 0) {
      log.warn("AUTH", `No credentials for ${provider}`);
      return null;
    }

    const availableConnections = connections.filter((c: Record<string, unknown>) => {
      if (excludeSet.has(c.id as string)) return false;
      if (isModelLockActive(c, model)) return false;
      return true;
    });

    log.debug("AUTH", `${provider} | available: ${availableConnections.length}/${connections.length}`);
    connections.forEach((c: Record<string, unknown>) => {
      const excluded = excludeSet.has(c.id as string);
      const locked = isModelLockActive(c, model);
      if (excluded || locked) {
        const lockUntil = getEarliestModelLockUntil(c);
        log.debug("AUTH", `  → ${(c.id as string)?.slice(0, 8)} | ${excluded ? "excluded" : ""} ${locked ? `modelLocked(${model}) until ${lockUntil}` : ""}`);
      }
    });

    if (availableConnections.length === 0) {
      const lockedConns = connections.filter((c: Record<string, unknown>) => isModelLockActive(c, model));
      const expiries = lockedConns.map((c: Record<string, unknown>) => getEarliestModelLockUntil(c)).filter(Boolean) as string[];
      const earliest = expiries.sort()[0] ?? null;
      if (earliest) {
        const earliestConn = lockedConns[0] as Record<string, unknown>;
        log.warn("AUTH", `${provider} | all ${connections.length} accounts locked for ${model ?? "all"} (${formatRetryAfter(earliest)}) | lastError=${(earliestConn?.lastError as string)?.slice(0, 50)}`);
        return {
          allRateLimited: true,
          retryAfter: earliest,
          retryAfterHuman: formatRetryAfter(earliest),
          lastError: earliestConn?.lastError ?? null,
          lastErrorCode: earliestConn?.errorCode ?? null,
        };
      }
      log.warn("AUTH", `${provider} | all ${connections.length} accounts unavailable`);
      return null;
    }

    const settings = await (await import("../db/index.ts")).getSettings();
    const providerOverride = ((settings.providerStrategies as Record<string, Record<string, unknown>> | undefined) ?? {})[providerId] ?? {};
    const strategy = (providerOverride.fallbackStrategy as string | undefined) ?? (settings.fallbackStrategy as string | undefined) ?? "fill-first";

    let connection: Record<string, unknown>;

    if (strategy === "round-robin") {
      const stickyLimit = (providerOverride.stickyRoundRobinLimit as number | undefined) ?? (settings.stickyRoundRobinLimit as number | undefined) ?? 3;

      const byRecency = [...availableConnections].sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
        if (!a.lastUsedAt && !b.lastUsedAt) return ((a.priority as number) || 999) - ((b.priority as number) || 999);
        if (!a.lastUsedAt) return 1;
        if (!b.lastUsedAt) return -1;
        return new Date(b.lastUsedAt as string).getTime() - new Date(a.lastUsedAt as string).getTime();
      });

      const current = byRecency[0] as Record<string, unknown>;
      const currentCount = (current?.consecutiveUseCount as number) || 0;

      if (current && current.lastUsedAt && currentCount < stickyLimit) {
        connection = current;
        await updateProviderConnection(connection.id as string, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: ((connection.consecutiveUseCount as number) || 0) + 1,
        });
      } else {
        const sortedByOldest = [...availableConnections].sort((a: Record<string, unknown>, b: Record<string, unknown>) => {
          if (!a.lastUsedAt && !b.lastUsedAt) return ((a.priority as number) || 999) - ((b.priority as number) || 999);
          if (!a.lastUsedAt) return -1;
          if (!b.lastUsedAt) return 1;
          return new Date(a.lastUsedAt as string).getTime() - new Date(b.lastUsedAt as string).getTime();
        });
        connection = sortedByOldest[0] as Record<string, unknown>;
        await updateProviderConnection(connection.id as string, {
          lastUsedAt: new Date().toISOString(),
          consecutiveUseCount: 1,
        });
      }
    } else {
      connection = availableConnections[0] as Record<string, unknown>;
    }

    const resolvedProxy = await resolveConnectionProxyConfig((connection.providerSpecificData as Record<string, unknown>) ?? {});

    return {
      apiKey: connection.apiKey,
      accessToken: connection.accessToken,
      refreshToken: connection.refreshToken,
      projectId: connection.projectId,
      connectionName: connection.displayName ?? connection.name ?? connection.email ?? connection.id,
      copilotToken: (connection.providerSpecificData as Record<string, unknown> | undefined)?.copilotToken,
      providerSpecificData: {
        ...((connection.providerSpecificData as Record<string, unknown>) ?? {}),
        connectionProxyEnabled: resolvedProxy.connectionProxyEnabled,
        connectionProxyUrl: resolvedProxy.connectionProxyUrl,
        connectionNoProxy: resolvedProxy.connectionNoProxy,
        connectionProxyPoolId: resolvedProxy.proxyPoolId ?? null,
      },
      connectionId: connection.id,
      testStatus: connection.testStatus,
      lastError: connection.lastError,
      _connection: connection,
    };
  } finally {
    resolveMutex!();
  }
}

/**
 * Mark account+model as unavailable — locks modelLock_${model} in DB.
 */
export async function markAccountUnavailable(
  connectionId: string,
  status: number,
  errorText: string,
  provider: string | null = null,
  model: string | null = null
): Promise<{ shouldFallback: boolean; cooldownMs: number }> {
  const connections = await getProviderConnections({ provider: provider ?? undefined });
  const conn = connections.find((c: Record<string, unknown>) => c.id === connectionId);
  const backoffLevel = (conn?.backoffLevel as number) || 0;

  const { shouldFallback, cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);
  if (!shouldFallback) return { shouldFallback: false, cooldownMs: 0 };

  const reason = typeof errorText === "string" ? errorText.slice(0, 100) : "Provider error";
  const lockUpdate = buildModelLockUpdate(model, cooldownMs);

  await updateProviderConnection(connectionId, {
    ...lockUpdate,
    testStatus: "unavailable",
    lastError: reason,
    errorCode: status,
    lastErrorAt: new Date().toISOString(),
    backoffLevel: newBackoffLevel ?? backoffLevel,
  });

  const lockKey = Object.keys(lockUpdate)[0] ?? "modelLock";
  const connName = (conn?.displayName ?? conn?.name ?? conn?.email ?? (connectionId as string).slice(0, 8)) as string;
  log.warn("AUTH", `${connName} locked ${lockKey} for ${Math.round(cooldownMs / 1000)}s [${status}]`);

  if (provider && status && reason) {
    console.error(`❌ ${provider} [${status}]: ${reason}`);
  }

  return { shouldFallback: true, cooldownMs };
}

/**
 * Clear account error status on successful request.
 */
export async function clearAccountError(
  connectionId: string,
  currentConnection: Record<string, unknown>,
  model: string | null = null
): Promise<void> {
  const conn = (currentConnection._connection ?? currentConnection) as Record<string, unknown>;
  const now = Date.now();
  const allLockKeys = Object.keys(conn).filter(k => k.startsWith("modelLock_"));

  if (!conn.testStatus && !conn.lastError && allLockKeys.length === 0) return;

  const keysToClear = allLockKeys.filter(k => {
    if (model && k === `modelLock_${model}`) return true;
    if (model && k === "modelLock___all") return true;
    const expiry = conn[k];
    return expiry && new Date(expiry as string).getTime() <= now;
  });

  if (keysToClear.length === 0 && conn.testStatus !== "unavailable" && !conn.lastError) return;

  const remainingActiveLocks = allLockKeys.filter(k => {
    if (keysToClear.includes(k)) return false;
    const expiry = conn[k];
    return expiry && new Date(expiry as string).getTime() > now;
  });

  const clearObj: Record<string, unknown> = Object.fromEntries(keysToClear.map(k => [k, null]));

  if (remainingActiveLocks.length === 0) {
    Object.assign(clearObj, { testStatus: "active", lastError: null, lastErrorAt: null, backoffLevel: 0 });
  }

  await updateProviderConnection(connectionId, clearObj);
  const connName = (conn?.displayName ?? conn?.name ?? conn?.email ?? (connectionId as string).slice(0, 8)) as string;
  log.info("AUTH", `Account ${connName} cleared lock for model=${model ?? "__all"}`);
}

/**
 * Extract API key from request headers
 */
export function extractApiKey(request: Request): string | null {
  const authHeader = request.headers.get("Authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }
  const xApiKey = request.headers.get("x-api-key");
  if (xApiKey) return xApiKey;
  return null;
}

/**
 * Validate API key against DB
 */
export async function isValidApiKey(apiKey: string): Promise<boolean> {
  if (!apiKey) return false;
  return validateApiKey(apiKey);
}
