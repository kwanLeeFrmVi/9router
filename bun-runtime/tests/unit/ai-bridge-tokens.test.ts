/**
 * Unit tests for ai-bridge/translator/common/tokens.ts
 * Covers: formatClaudeTokens, formatGeminiTokens, buildClaudeUsage, extractTokensFromOpenAIUsage
 */

import { describe, it, expect } from "bun:test";
import {
  formatClaudeTokens,
  formatGeminiTokens,
  buildClaudeUsage,
  extractTokensFromOpenAIUsage,
} from "../../ai-bridge/translator/common/tokens.ts";

// ─── formatClaudeTokens ──────────────────────────────────────────────────────

describe("formatClaudeTokens", () => {
  it("formats token count as JSON with input_tokens", () => {
    const result = formatClaudeTokens(100);
    const parsed = JSON.parse(result);
    expect(parsed.input_tokens).toBe(100);
  });

  it("handles zero tokens", () => {
    const result = formatClaudeTokens(0);
    const parsed = JSON.parse(result);
    expect(parsed.input_tokens).toBe(0);
  });
});

// ─── formatGeminiTokens ──────────────────────────────────────────────────────

describe("formatGeminiTokens", () => {
  it("formats tokens with totalTokens and promptTokensDetails", () => {
    const result = formatGeminiTokens(200);
    const parsed = JSON.parse(result);
    expect(parsed.totalTokens).toBe(200);
    expect(parsed.promptTokensDetails).toHaveLength(1);
    expect(parsed.promptTokensDetails[0].modality).toBe("TEXT");
    expect(parsed.promptTokensDetails[0].tokenCount).toBe(200);
  });
});

// ─── buildClaudeUsage ─────────────────────────────────────────────────────────

describe("buildClaudeUsage", () => {
  it("builds usage object with input and output tokens", () => {
    const usage = buildClaudeUsage(100, 50);
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(50);
    expect(usage.cache_read_input_tokens).toBeUndefined();
  });

  it("includes cache_read_input_tokens when cachedTokens > 0", () => {
    const usage = buildClaudeUsage(100, 50, 30);
    expect(usage.input_tokens).toBe(100);
    expect(usage.output_tokens).toBe(50);
    expect(usage.cache_read_input_tokens).toBe(30);
  });

  it("omits cache_read_input_tokens when cachedTokens is 0 (default)", () => {
    const usage = buildClaudeUsage(100, 50);
    expect(usage.cache_read_input_tokens).toBeUndefined();
  });
});

// ─── extractTokensFromOpenAIUsage ─────────────────────────────────────────────

describe("extractTokensFromOpenAIUsage", () => {
  it("extracts tokens from a standard OpenAI usage object", () => {
    const result = extractTokensFromOpenAIUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    });
    expect(result.inputTokens).toBe(100);
    expect(result.outputTokens).toBe(50);
    expect(result.cachedTokens).toBe(0);
  });

  it("subtracts cached tokens from input tokens", () => {
    const result = extractTokensFromOpenAIUsage({
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
      prompt_tokens_details: { cached_tokens: 30 },
    });
    expect(result.inputTokens).toBe(70); // 100 - 30
    expect(result.outputTokens).toBe(50);
    expect(result.cachedTokens).toBe(30);
  });

  it("returns zeros for null usage", () => {
    const result = extractTokensFromOpenAIUsage(null);
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cachedTokens).toBe(0);
  });

  it("handles missing fields gracefully", () => {
    const result = extractTokensFromOpenAIUsage({});
    expect(result.inputTokens).toBe(0);
    expect(result.outputTokens).toBe(0);
    expect(result.cachedTokens).toBe(0);
  });

  it("does not subtract cached if prompt < cached", () => {
    const result = extractTokensFromOpenAIUsage({
      prompt_tokens: 10,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 30 },
    });
    // cached > prompt, so don't subtract
    expect(result.inputTokens).toBe(10);
    expect(result.cachedTokens).toBe(30);
  });
});