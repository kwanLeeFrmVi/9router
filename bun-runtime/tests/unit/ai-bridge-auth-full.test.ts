/**
 * Unit tests for ai-bridge/services/auth.ts
 * Covers: isAccountUnavailable, getUnavailableUntil, getModelLockKey, isModelLockActive,
 * getEarliestModelLockUntil, buildModelLockUpdate, buildClearModelLocksUpdate,
 * formatRetryAfter, getEarliestRateLimitedUntil, filterAvailableAccounts,
 * resetAccountState, applyErrorState
 */

import { describe, it, expect } from "bun:test";
import {
  isAccountUnavailable,
  getUnavailableUntil,
  getModelLockKey,
  isModelLockActive,
  getEarliestModelLockUntil,
  buildModelLockUpdate,
  buildClearModelLocksUpdate,
  formatRetryAfter,
  getEarliestRateLimitedUntil,
  filterAvailableAccounts,
  resetAccountState,
  applyErrorState,
  MODEL_LOCK_PREFIX,
  MODEL_LOCK_ALL,
} from "../../ai-bridge/services/auth.ts";

// ─── isAccountUnavailable ─────────────────────────────────────────────────────

describe("isAccountUnavailable", () => {
  it("returns true if unavailableUntil is in the future", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    expect(isAccountUnavailable(future)).toBe(true);
  });

  it("returns false if unavailableUntil is in the past", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(isAccountUnavailable(past)).toBe(false);
  });

  it("returns false for null", () => {
    expect(isAccountUnavailable(null)).toBe(false);
  });

  it("returns false for undefined", () => {
    expect(isAccountUnavailable(undefined)).toBe(false);
  });

  it("returns false for empty string", () => {
    expect(isAccountUnavailable("")).toBe(false);
  });
});

// ─── getUnavailableUntil ──────────────────────────────────────────────────────

describe("getUnavailableUntil", () => {
  it("returns an ISO date string approximately cooldownMs from now", () => {
    const before = Date.now() + 5000;
    const result = getUnavailableUntil(5000);
    const after = Date.now() + 5000;
    const resultTime = new Date(result).getTime();
    expect(resultTime).toBeGreaterThanOrEqual(before);
    expect(resultTime).toBeLessThanOrEqual(after + 10); // small tolerance
  });

  it("returns a valid ISO date string", () => {
    const result = getUnavailableUntil(1000);
    expect(() => new Date(result)).not.toThrow();
    expect(new Date(result).getTime()).toBeGreaterThan(Date.now() - 1000);
  });
});

// ─── Model Lock ───────────────────────────────────────────────────────────────

describe("getModelLockKey", () => {
  it("returns modelLock_<model> for a model name", () => {
    expect(getModelLockKey("gpt-4o")).toBe("modelLock_gpt-4o");
  });

  it("returns MODEL_LOCK_ALL for null model", () => {
    expect(getModelLockKey(null)).toBe(MODEL_LOCK_ALL);
  });
});

describe("isModelLockActive", () => {
  it("returns true when model lock is in the future", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const conn = { modelLock_gpt4o: future };
    expect(isModelLockActive(conn, "gpt4o")).toBe(true);
  });

  it("returns false when model lock is in the past", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const conn = { modelLock_gpt4o: past };
    expect(isModelLockActive(conn, "gpt4o")).toBe(false);
  });

  it("returns false when no lock exists for the model", () => {
    expect(isModelLockActive({}, "gpt-4o")).toBe(false);
  });

  it("checks __all lock when specific model lock is not set", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const conn = { [MODEL_LOCK_ALL]: future };
    expect(isModelLockActive(conn, "gpt-4o")).toBe(true);
  });
});

describe("getEarliestModelLockUntil", () => {
  it("returns null for null connection", () => {
    expect(getEarliestModelLockUntil(null)).toBeNull();
  });

  it("returns null for connection with no locks", () => {
    expect(getEarliestModelLockUntil({})).toBeNull();
  });

  it("returns earliest active lock", () => {
    const soon = new Date(Date.now() + 30000).toISOString();
    const later = new Date(Date.now() + 60000).toISOString();
    const conn = { modelLock_a: later, modelLock_b: soon };
    const result = getEarliestModelLockUntil(conn);
    expect(result).not.toBeNull();
    expect(new Date(result!).getTime()).toBe(new Date(soon).getTime());
  });

  it("ignores expired locks", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const conn = { modelLock_a: past };
    expect(getEarliestModelLockUntil(conn)).toBeNull();
  });

  it("ignores non-modelLock keys", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const conn = { someOtherKey: future };
    expect(getEarliestModelLockUntil(conn)).toBeNull();
  });
});

describe("buildModelLockUpdate", () => {
  it("returns object with model lock key set to future ISO date", () => {
    const update = buildModelLockUpdate("gpt-4o", 5000);
    const key = "modelLock_gpt-4o";
    expect(update[key]).toBeDefined();
    expect(new Date(update[key] as string).getTime()).toBeGreaterThan(Date.now() - 1000);
  });

  it("uses MODEL_LOCK_ALL for null model", () => {
    const update = buildModelLockUpdate(null, 5000);
    expect(update[MODEL_LOCK_ALL]).toBeDefined();
  });
});

describe("buildClearModelLocksUpdate", () => {
  it("returns null for all modelLock_ keys", () => {
    const conn = { modelLock_a: "future", modelLock_b: "future", otherKey: "value" };
    const update = buildClearModelLocksUpdate(conn);
    expect(update.modelLock_a).toBeNull();
    expect(update.modelLock_b).toBeNull();
    expect((update as Record<string, unknown>).otherKey).toBeUndefined();
  });

  it("returns empty object for connection with no model locks", () => {
    const conn = { foo: "bar", baz: "qux" };
    const update = buildClearModelLocksUpdate(conn);
    expect(Object.keys(update)).toHaveLength(0);
  });
});

// ─── Retry Formatting ─────────────────────────────────────────────────────────

describe("formatRetryAfter", () => {
  it("returns empty string for null", () => {
    expect(formatRetryAfter(null)).toBe("");
  });

  it("returns empty string for undefined", () => {
    expect(formatRetryAfter(undefined)).toBe("");
  });

  it("returns reset after Xs for seconds", () => {
    const future = new Date(Date.now() + 5000).toISOString();
    expect(formatRetryAfter(future)).toBe("reset after 5s");
  });

  it("returns hours, minutes, seconds for longer durations", () => {
    const future = new Date(Date.now() + 3665000).toISOString(); // 1h 1m 5s
    const result = formatRetryAfter(future);
    expect(result).toContain("1h");
    expect(result).toContain("1m");
    expect(result).toContain("5s");
  });

  it("returns reset after 0s for past date", () => {
    const past = new Date(Date.now() - 5000).toISOString();
    expect(formatRetryAfter(past)).toBe("reset after 0s");
  });
});

// ─── getEarliestRateLimitedUntil ──────────────────────────────────────────────

describe("getEarliestRateLimitedUntil", () => {
  it("returns null for empty array", () => {
    expect(getEarliestRateLimitedUntil([])).toBeNull();
  });

  it("returns null when all accounts have no rate limit", () => {
    expect(getEarliestRateLimitedUntil([{}, {}])).toBeNull();
  });

  it("returns the earliest future rate limit", () => {
    const soon = new Date(Date.now() + 30000).toISOString();
    const later = new Date(Date.now() + 60000).toISOString();
    const result = getEarliestRateLimitedUntil([
      { rateLimitedUntil: later },
      { rateLimitedUntil: soon },
    ]);
    expect(result).not.toBeNull();
    expect(new Date(result!).getTime()).toBe(new Date(soon).getTime());
  });

  it("ignores expired rate limits", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    expect(getEarliestRateLimitedUntil([{ rateLimitedUntil: past }])).toBeNull();
  });

  it("ignores null rateLimitedUntil", () => {
    expect(getEarliestRateLimitedUntil([{ rateLimitedUntil: null }])).toBeNull();
  });
});

// ─── filterAvailableAccounts ──────────────────────────────────────────────────

describe("filterAvailableAccounts", () => {
  it("returns all accounts when none are rate limited", () => {
    const accounts = [{ id: "a" }, { id: "b" }];
    expect(filterAvailableAccounts(accounts)).toHaveLength(2);
  });

  it("filters out rate-limited accounts", () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const accounts = [{ id: "a" }, { id: "b", rateLimitedUntil: future }];
    const result = filterAvailableAccounts(accounts);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("a");
  });

  it("excludes account by id", () => {
    const accounts = [{ id: "a" }, { id: "b" }];
    const result = filterAvailableAccounts(accounts, "a");
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("b");
  });

  it("keeps accounts with expired rate limits", () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const accounts = [{ id: "a", rateLimitedUntil: past }];
    expect(filterAvailableAccounts(accounts)).toHaveLength(1);
  });

  it("handles empty array", () => {
    expect(filterAvailableAccounts([])).toHaveLength(0);
  });
});

// ─── resetAccountState ────────────────────────────────────────────────────────

describe("resetAccountState", () => {
  it("resets rateLimitedUntil, backoffLevel, lastError, status", () => {
    const account = {
      id: "a",
      rateLimitedUntil: "future",
      backoffLevel: 5,
      lastError: { status: 429, message: "rate limited" },
      status: "error",
      customField: "preserved",
    };
    const result = resetAccountState(account);
    expect(result.rateLimitedUntil).toBeNull();
    expect(result.backoffLevel).toBe(0);
    expect(result.lastError).toBeNull();
    expect(result.status).toBe("active");
    expect(result.customField).toBe("preserved");
    expect(result.id).toBe("a");
  });
});

// ─── applyErrorState ──────────────────────────────────────────────────────────

describe("applyErrorState", () => {
  it("sets error state for 429 rate limit", () => {
    const account = { id: "a", backoffLevel: 0 };
    const result = applyErrorState(account, 429, "rate limit exceeded");
    expect(result.status).toBe("error");
    expect(result.rateLimitedUntil).not.toBeNull();
    expect(result.backoffLevel).toBe(1);
    expect(result.lastError.status).toBe(429);
  });

  it("increments backoffLevel on repeated rate limits", () => {
    const account = { id: "a", backoffLevel: 2 };
    const result = applyErrorState(account, 429, "rate limit");
    expect(result.backoffLevel).toBe(3);
  });

  it("sets error state for 401 unauthorized", () => {
    const account = { id: "a", backoffLevel: 0 };
    const result = applyErrorState(account, 401, "invalid key");
    expect(result.status).toBe("error");
    expect(result.rateLimitedUntil).not.toBeNull();
    expect(result.lastError.message).toBe("invalid key");
  });

  it("preserves other account fields", () => {
    const account = { id: "a", name: "test", customProp: true };
    const result = applyErrorState(account, 500, "server error");
    expect(result.id).toBe("a");
    expect(result.name).toBe("test");
    expect((result as Record<string, unknown>).customProp).toBe(true);
  });

  it("handles transient errors (500, 502, 503, 504)", () => {
    for (const status of [500, 502, 503, 504]) {
      const account = { id: "a", backoffLevel: 0 };
      const result = applyErrorState(account, status, "error");
      expect(result.status).toBe("error");
      expect(result.rateLimitedUntil).not.toBeNull();
    }
  });

  it("returns no fallback for unhandled status codes (e.g., 200)", () => {
    const account = { id: "a", backoffLevel: 0 };
    const result = applyErrorState(account, 200, "ok");
    expect(result.status).toBe("error"); // applyErrorState always sets "error"
    expect(result.rateLimitedUntil).toBeNull(); // no cooldown for 200
  });
});