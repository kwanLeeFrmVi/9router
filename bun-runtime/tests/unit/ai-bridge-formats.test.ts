/**
 * Unit tests for ai-bridge/translator/formats.ts
 * Covers: FORMATS constants, fromString, detectFormatByEndpoint, ALL_FORMATS
 */

import { describe, it, expect } from "bun:test";
import { FORMATS, ALL_FORMATS, fromString, detectFormatByEndpoint } from "../../ai-bridge/translator/formats.ts";

// ─── FORMATS constants ────────────────────────────────────────────────────────

describe("FORMATS", () => {
  it("has all expected format keys", () => {
    expect(FORMATS.OPENAI).toBe("openai");
    expect(FORMATS.OPENAI_RESPONSES).toBe("openai-responses");
    expect(FORMATS.OPENAI_RESPONSE).toBe("openai-response");
    expect(FORMATS.CLAUDE).toBe("claude");
    expect(FORMATS.GEMINI).toBe("gemini");
    expect(FORMATS.GEMINI_CLI).toBe("gemini-cli");
    expect(FORMATS.VERTEX).toBe("vertex");
    expect(FORMATS.CODEX).toBe("codex");
    expect(FORMATS.ANTIGRAVITY).toBe("antigravity");
    expect(FORMATS.KIRO).toBe("kiro");
    expect(FORMATS.CURSOR).toBe("cursor");
    expect(FORMATS.OLLAMA).toBe("ollama");
  });
});

// ─── ALL_FORMATS ───────────────────────────────────────────────────────────────

describe("ALL_FORMATS", () => {
  it("contains all format values", () => {
    expect(ALL_FORMATS).toContain(FORMATS.OPENAI);
    expect(ALL_FORMATS).toContain(FORMATS.CLAUDE);
    expect(ALL_FORMATS).toContain(FORMATS.GEMINI);
    expect(ALL_FORMATS).toContain(FORMATS.OLLAMA);
  });

  it("has length matching number of FORMAT keys", () => {
    expect(ALL_FORMATS.length).toBe(Object.keys(FORMATS).length);
  });
});

// ─── fromString ────────────────────────────────────────────────────────────────

describe("fromString", () => {
  it("returns matching format for known KEY names (uppercase)", () => {
    // fromString looks up keys like "OPENAI", not values like "openai"
    expect(fromString("OPENAI")).toBe(FORMATS.OPENAI);
    expect(fromString("CLAUDE")).toBe(FORMATS.CLAUDE);
    expect(fromString("GEMINI")).toBe(FORMATS.GEMINI);
    expect(fromString("OLLAMA")).toBe(FORMATS.OLLAMA);
  });

  it("returns OPENAI for unknown strings", () => {
    expect(fromString("unknown")).toBe(FORMATS.OPENAI);
    expect(fromString("")).toBe(FORMATS.OPENAI);
    // Lowercase format values are NOT keys, so they fall through
    expect(fromString("openai")).toBe(FORMATS.OPENAI);
    expect(fromString("claude")).toBe(FORMATS.OPENAI);
  });
});

// ─── detectFormatByEndpoint ────────────────────────────────────────────────────

describe("detectFormatByEndpoint", () => {
  it("returns OPENAI_RESPONSES for /v1/responses endpoint", () => {
    expect(detectFormatByEndpoint("/v1/responses", null)).toBe(FORMATS.OPENAI_RESPONSES);
  });

  it("returns CLAUDE for /v1/messages endpoint", () => {
    expect(detectFormatByEndpoint("/v1/messages", null)).toBe(FORMATS.CLAUDE);
  });

  it("returns OPENAI for /v1/chat/completions with input array body", () => {
    expect(detectFormatByEndpoint("/v1/chat/completions", { input: [] })).toBe(FORMATS.OPENAI);
  });

  it("returns null for /v1/chat/completions without input array", () => {
    expect(detectFormatByEndpoint("/v1/chat/completions", { messages: [] })).toBeNull();
  });

  it("returns null for unknown endpoint", () => {
    expect(detectFormatByEndpoint("/v1/unknown", null)).toBeNull();
  });

  it("returns null for empty pathname", () => {
    expect(detectFormatByEndpoint("", null)).toBeNull();
  });
});