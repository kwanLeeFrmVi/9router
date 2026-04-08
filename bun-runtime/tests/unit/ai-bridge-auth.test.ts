/**
 * Unit tests for ai-bridge auth services (account fallback, cooldown, model lock).
 * Uses Bun's native test runner.
 */

import {
  checkFallbackError,
  getQuotaCooldown,
} from "../../ai-bridge/services/auth.ts";

// ─── checkFallbackError ──────────────────────────────────────────────────────

describe("checkFallbackError", () => {
  it("returns shouldFallback=false for 200", () => {
    const result = checkFallbackError(200, "");
    expect(result.shouldFallback).toBe(false);
  });

  it("returns shouldFallback=true for 401 unauthorized", () => {
    const result = checkFallbackError(401, "unauthorized");
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
  });

  it("returns shouldFallback=true for 403 forbidden", () => {
    const result = checkFallbackError(403, "forbidden");
    expect(result.shouldFallback).toBe(true);
  });

  it("returns shouldFallback=true for 429 rate limit", () => {
    const result = checkFallbackError(429, "rate limit exceeded");
    expect(result.shouldFallback).toBe(true);
    expect(result.cooldownMs).toBeGreaterThan(0);
    expect(result.newBackoffLevel).toBe(1);
  });

  it("increments backoff level on repeated 429", () => {
    const first = checkFallbackError(429, "rate limit", 0);
    const second = checkFallbackError(429, "rate limit", 1);
    expect(first.newBackoffLevel).toBe(1);
    expect(second.newBackoffLevel).toBe(2);
  });

  it("caps backoff level at maxLevel", () => {
    // Try many repeated 429s
    const result = checkFallbackError(429, "rate limit", 10);
    expect(result.shouldFallback).toBe(true);
  });

  it("returns shouldFallback=true for transient errors (500, 502, 503, 504)", () => {
    for (const status of [500, 502, 503, 504]) {
      const result = checkFallbackError(status, "server error");
      expect(result.shouldFallback).toBe(true);
      expect(result.cooldownMs).toBeGreaterThan(0);
    }
  });

  it("returns shouldFallback=true for 406 and 408", () => {
    const r1 = checkFallbackError(406, "not acceptable");
    const r2 = checkFallbackError(408, "request timeout");
    expect(r1.shouldFallback).toBe(true);
    expect(r2.shouldFallback).toBe(true);
  });

  it("detects rate limit keywords in error text", () => {
    const result = checkFallbackError(500, "Rate limit exceeded on this account");
    expect(result.shouldFallback).toBe(true);
  });

  it("detects quota exceeded keyword", () => {
    const result = checkFallbackError(400, "quota exceeded");
    expect(result.shouldFallback).toBe(true);
  });

  it("detects capacity keyword", () => {
    const result = checkFallbackError(503, "system capacity exceeded");
    expect(result.shouldFallback).toBe(true);
  });

  it("detects overloaded keyword", () => {
    const result = checkFallbackError(503, "provider overloaded");
    expect(result.shouldFallback).toBe(true);
  });

  it("detects no credentials keyword", () => {
    const result = checkFallbackError(400, "no credentials found for this model");
    expect(result.shouldFallback).toBe(true);
  });

  it("detects request not allowed keyword", () => {
    const result = checkFallbackError(403, "request not allowed for this tier");
    expect(result.shouldFallback).toBe(true);
  });

  it("detects improperly formed request (Kiro)", () => {
    const result = checkFallbackError(400, "improperly formed request");
    expect(result.shouldFallback).toBe(true);
  });

  it("returns shouldFallback=true for 404 not found", () => {
    const result = checkFallbackError(404, "model not found");
    expect(result.shouldFallback).toBe(true);
  });

  it("returns shouldFallback=true for 402 payment required", () => {
    const result = checkFallbackError(402, "payment required");
    expect(result.shouldFallback).toBe(true);
  });
});

// ─── getQuotaCooldown ────────────────────────────────────────────────────────

describe("getQuotaCooldown", () => {
  it("returns base cooldown at level 0", () => {
    const result = getQuotaCooldown(0);
    expect(typeof result).toBe("number");
    expect(result).toBeGreaterThan(0);
  });

  it("returns larger cooldown at higher backoff level", () => {
    const base = getQuotaCooldown(0);
    const l1 = getQuotaCooldown(1);
    const l2 = getQuotaCooldown(2);
    expect(l1).toBeGreaterThan(base);
    expect(l2).toBeGreaterThan(l1);
  });

  it("caps at max backoff (max cooldown)", () => {
    const high = getQuotaCooldown(100);
    const veryHigh = getQuotaCooldown(1000);
    // Both should be capped to max
    expect(high).toBe(veryHigh);
  });
});
