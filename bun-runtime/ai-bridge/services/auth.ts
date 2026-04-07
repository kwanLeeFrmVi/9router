// Account fallback and cooldown logic.
// Written from scratch in TypeScript.

import { COOLDOWN_MS, BACKOFF_CONFIG, HTTP_STATUS } from "../config/runtimeConfig.ts";

// ─── Quota / Rate Limit Cooldown ───────────────────────────────────────────────

export function getQuotaCooldown(backoffLevel = 0): number {
  const cooldown = BACKOFF_CONFIG.base * Math.pow(2, backoffLevel);
  return Math.min(cooldown, BACKOFF_CONFIG.max);
}

// ─── Error → Fallback Decision ────────────────────────────────────────────────

export interface FallbackResult {
  shouldFallback: boolean;
  cooldownMs: number;
  newBackoffLevel?: number;
}

/**
 * Check if error should trigger account fallback (switch to next account).
 */
export function checkFallbackError(
  status: number,
  errorText: string,
  backoffLevel = 0
): FallbackResult {
  if (errorText) {
    const errorStr = typeof errorText === "string" ? errorText : JSON.stringify(errorText);
    const lowerError = errorStr.toLowerCase();

    if (lowerError.includes("no credentials")) {
      return { shouldFallback: true, cooldownMs: COOLDOWN_MS.notFound };
    }
    if (lowerError.includes("request not allowed")) {
      return { shouldFallback: true, cooldownMs: COOLDOWN_MS.requestNotAllowed };
    }
    // Kiro: "improperly formed request" = model not available on this account tier
    if (lowerError.includes("improperly formed request")) {
      return { shouldFallback: true, cooldownMs: COOLDOWN_MS.paymentRequired };
    }
    // Rate limit keywords — exponential backoff
    if (
      lowerError.includes("rate limit") ||
      lowerError.includes("too many requests") ||
      lowerError.includes("quota exceeded") ||
      lowerError.includes("capacity") ||
      lowerError.includes("overloaded")
    ) {
      return {
        shouldFallback: true,
        cooldownMs: getQuotaCooldown(backoffLevel),
        newBackoffLevel: Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel),
      };
    }
  }

  if (status === HTTP_STATUS.UNAUTHORIZED) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_MS.unauthorized };
  }
  if (status === HTTP_STATUS.PAYMENT_REQUIRED || status === HTTP_STATUS.FORBIDDEN) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_MS.paymentRequired };
  }
  if (status === HTTP_STATUS.NOT_FOUND) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_MS.notFound };
  }
  if (status === HTTP_STATUS.RATE_LIMITED) {
    return {
      shouldFallback: true,
      cooldownMs: getQuotaCooldown(backoffLevel),
      newBackoffLevel: Math.min(backoffLevel + 1, BACKOFF_CONFIG.maxLevel),
    };
  }

  // Transient errors
  const transient = [406, 408, 500, 502, 503, 504];
  if (transient.includes(status)) {
    return { shouldFallback: true, cooldownMs: COOLDOWN_MS.transient };
  }

  return { shouldFallback: false, cooldownMs: 0 };
}

// ─── Account Unavailability ────────────────────────────────────────────────────

export function isAccountUnavailable(unavailableUntil: string | null | undefined): boolean {
  if (!unavailableUntil) return false;
  return new Date(unavailableUntil).getTime() > Date.now();
}

export function getUnavailableUntil(cooldownMs: number): string {
  return new Date(Date.now() + cooldownMs).toISOString();
}

// ─── Model Lock ─────────────────────────────────────────────────────────────────

export const MODEL_LOCK_PREFIX = "modelLock_";
export const MODEL_LOCK_ALL = `${MODEL_LOCK_PREFIX}__all`;

export function getModelLockKey(model: string | null): string {
  return model ? `${MODEL_LOCK_PREFIX}${model}` : MODEL_LOCK_ALL;
}

export function isModelLockActive(connection: Record<string, unknown>, model: string | null): boolean {
  const key = getModelLockKey(model);
  const expiry = (connection[key] ?? connection[MODEL_LOCK_ALL]) as string | undefined;
  if (!expiry) return false;
  return new Date(expiry).getTime() > Date.now();
}

export function getEarliestModelLockUntil(connection: Record<string, unknown> | null): string | null {
  if (!connection) return null;
  let earliest: number | null = null;
  const now = Date.now();
  for (const [key, val] of Object.entries(connection)) {
    if (!key.startsWith(MODEL_LOCK_PREFIX) || !val) continue;
    const t = new Date(val as string).getTime();
    if (t <= now) continue;
    if (earliest === null || t < earliest) earliest = t;
  }
  return earliest !== null ? new Date(earliest).toISOString() : null;
}

export function buildModelLockUpdate(model: string | null, cooldownMs: number): Record<string, string> {
  const key = getModelLockKey(model);
  return { [key]: new Date(Date.now() + cooldownMs).toISOString() };
}

export function buildClearModelLocksUpdate(connection: Record<string, unknown>): Record<string, null> {
  const cleared: Record<string, null> = {};
  for (const key of Object.keys(connection)) {
    if (key.startsWith(MODEL_LOCK_PREFIX)) cleared[key] = null;
  }
  return cleared;
}

// ─── Retry Formatting ───────────────────────────────────────────────────────────

export function formatRetryAfter(rateLimitedUntil: string | null | undefined): string {
  if (!rateLimitedUntil) return "";
  const diffMs = new Date(rateLimitedUntil).getTime() - Date.now();
  if (diffMs <= 0) return "reset after 0s";
  const totalSec = Math.ceil(diffMs / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const parts: string[] = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  if (s > 0 || parts.length === 0) parts.push(`${s}s`);
  return `reset after ${parts.join(" ")}`;
}

export function getEarliestRateLimitedUntil(
  accounts: Array<{ rateLimitedUntil?: string | null }>
): string | null {
  let earliest: number | null = null;
  const now = Date.now();
  for (const acc of accounts) {
    if (!acc.rateLimitedUntil) continue;
    const until = new Date(acc.rateLimitedUntil).getTime();
    if (until <= now) continue;
    if (earliest === null || until < earliest) earliest = until;
  }
  return earliest !== null ? new Date(earliest).toISOString() : null;
}

// ─── Account Filtering ─────────────────────────────────────────────────────────

export function filterAvailableAccounts<T extends { id?: string; rateLimitedUntil?: string | null }>(
  accounts: T[],
  excludeId: string | null = null
): T[] {
  const now = Date.now();
  return accounts.filter(acc => {
    if (excludeId && acc.id === excludeId) return false;
    if (acc.rateLimitedUntil) {
      const until = new Date(acc.rateLimitedUntil).getTime();
      if (until > now) return false;
    }
    return true;
  });
}

// ─── Account State Helpers ─────────────────────────────────────────────────────

export function resetAccountState<T extends Record<string, unknown>>(account: T): T {
  return {
    ...account,
    rateLimitedUntil: null,
    backoffLevel: 0,
    lastError: null,
    status: "active",
  };
}

export interface AccountErrorState {
  rateLimitedUntil: string | null;
  backoffLevel: number;
  lastError: { status: number; message: string; timestamp: string };
  status: string;
}

export function applyErrorState<T extends Record<string, unknown>>(
  account: T,
  status: number,
  errorText: string
): T {
  const backoffLevel = (account.backoffLevel as number) || 0;
  const { cooldownMs, newBackoffLevel } = checkFallbackError(status, errorText, backoffLevel);

  return {
    ...account,
    rateLimitedUntil: cooldownMs > 0 ? getUnavailableUntil(cooldownMs) : null,
    backoffLevel: newBackoffLevel ?? backoffLevel,
    lastError: { status, message: errorText, timestamp: new Date().toISOString() },
    status: "error",
  } as T;
}