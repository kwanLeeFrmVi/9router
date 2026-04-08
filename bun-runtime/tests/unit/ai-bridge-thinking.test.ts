/**
 * Unit tests for ai-bridge/translator/thinking/index.ts
 * Covers: THINKING_LEVELS, convertBudgetToLevel, getThinkingText, levelToBudget, buildThinkingBlock
 */

import { describe, it, expect } from "bun:test";
import {
  THINKING_LEVELS,
  convertBudgetToLevel,
  getThinkingText,
  levelToBudget,
  buildThinkingBlock,
} from "../../ai-bridge/translator/thinking/index.ts";

// ─── convertBudgetToLevel ─────────────────────────────────────────────────────

describe("convertBudgetToLevel", () => {
  it("returns medium effort for budget=-1 (enabled, default)", () => {
    const result = convertBudgetToLevel(-1);
    expect(result.effort).toBe(THINKING_LEVELS.MEDIUM);
    expect(result.ok).toBe(true);
  });

  it("returns empty effort for budget=0 (disabled)", () => {
    const result = convertBudgetToLevel(0);
    expect(result.effort).toBe("");
    expect(result.ok).toBe(true);
  });

  it("returns low for small budgets (1024, 4096)", () => {
    expect(convertBudgetToLevel(1024).effort).toBe(THINKING_LEVELS.LOW);
    expect(convertBudgetToLevel(4096).effort).toBe(THINKING_LEVELS.LOW);
  });

  it("returns medium for budget=8192", () => {
    expect(convertBudgetToLevel(8192).effort).toBe(THINKING_LEVELS.MEDIUM);
  });

  it("returns high for budgets 16384–20000", () => {
    expect(convertBudgetToLevel(16384).effort).toBe(THINKING_LEVELS.HIGH);
    expect(convertBudgetToLevel(20000).effort).toBe(THINKING_LEVELS.HIGH);
  });

  it("returns x-high for budgets >= 32000", () => {
    expect(convertBudgetToLevel(32000).effort).toBe(THINKING_LEVELS.XHIGH);
    expect(convertBudgetToLevel(64000).effort).toBe(THINKING_LEVELS.XHIGH);
  });

  it("finds closest level for arbitrary budget values", () => {
    // 5000 is closer to 4096 (low) than 8192 (medium)
    const result = convertBudgetToLevel(5000);
    expect(result.effort).toBe(THINKING_LEVELS.LOW);
    expect(result.ok).toBe(true);
  });

  it("returns ok=false for budget too close to 0 (disabled)", () => {
    // budget=1 is closest to 0 which maps to "" (disabled), so ok=false
    expect(convertBudgetToLevel(1).ok).toBe(false);
  });

  it("returns ok=true for sufficiently large budgets", () => {
    expect(convertBudgetToLevel(100000).ok).toBe(true);
  });
});

// ─── getThinkingText ──────────────────────────────────────────────────────────

describe("getThinkingText", () => {
  it("extracts text from a thinking block", () => {
    const part = { type: "thinking", thinking: "Let me reason about this..." };
    expect(getThinkingText(part)).toBe("Let me reason about this...");
  });

  it("returns empty string for non-thinking block", () => {
    const part = { type: "text", text: "hello" };
    expect(getThinkingText(part)).toBe("");
  });

  it("returns empty string when thinking field is missing", () => {
    const part = { type: "thinking" };
    expect(getThinkingText(part)).toBe("");
  });

  it("handles numeric thinking value", () => {
    const part = { type: "thinking", thinking: 42 };
    expect(getThinkingText(part)).toBe("42");
  });
});

// ─── levelToBudget ────────────────────────────────────────────────────────────

describe("levelToBudget", () => {
  it("returns 0 for off", () => {
    expect(levelToBudget("off")).toBe(0);
  });

  it("returns 4096 for low", () => {
    expect(levelToBudget("low")).toBe(4096);
  });

  it("returns 8192 for medium", () => {
    expect(levelToBudget("medium")).toBe(8192);
  });

  it("returns 16384 for high", () => {
    expect(levelToBudget("high")).toBe(16384);
  });

  it("returns 32000 for x-high", () => {
    expect(levelToBudget("x-high")).toBe(32000);
  });

  it("returns null for unknown effort", () => {
    expect(levelToBudget("unknown")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(levelToBudget("")).toBeNull();
  });

  it("is case-insensitive", () => {
    expect(levelToBudget("HIGH")).toBe(16384);
    expect(levelToBudget("Medium")).toBe(8192);
  });
});

// ─── buildThinkingBlock ──────────────────────────────────────────────────────

describe("buildThinkingBlock", () => {
  it("creates a thinking block with the given text", () => {
    const block = buildThinkingBlock("reasoning text") as Record<string, unknown>;
    expect(block.type).toBe("thinking");
    expect(block.thinking).toBe("reasoning text");
  });

  it("creates a thinking block with empty text", () => {
    const block = buildThinkingBlock("") as Record<string, unknown>;
    expect(block.type).toBe("thinking");
    expect(block.thinking).toBe("");
  });
});