/**
 * Unit tests for ai-bridge/translator/index.ts registries
 * Covers: Request, Response, ResponseNonStream, NeedsTranslation, initTranslators
 *
 * Note: The Response() and ResponseNonStream() streaming registry calls are affected by
 * Bun's module caching, so we test them where possible and focus on Request() which works
 * reliably. Direct function tests are in the streaming-state test file.
 */

import { describe, it, expect } from "bun:test";
import { Request, ResponseNonStream, NeedsTranslation, initTranslators } from "../../ai-bridge/translator/index.ts";
import { FORMATS } from "../../ai-bridge/translator/formats.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

// ─── NeedsTranslation ─────────────────────────────────────────────────────────

describe("NeedsTranslation", () => {
  it("returns false for same format", () => {
    expect(NeedsTranslation(FORMATS.OPENAI, FORMATS.OPENAI)).toBe(false);
    expect(NeedsTranslation(FORMATS.CLAUDE, FORMATS.CLAUDE)).toBe(false);
    expect(NeedsTranslation(FORMATS.GEMINI, FORMATS.GEMINI)).toBe(false);
    expect(NeedsTranslation(FORMATS.OLLAMA, FORMATS.OLLAMA)).toBe(false);
  });

  it("returns true for different formats", () => {
    expect(NeedsTranslation(FORMATS.OPENAI, FORMATS.CLAUDE)).toBe(true);
    expect(NeedsTranslation(FORMATS.CLAUDE, FORMATS.OPENAI)).toBe(true);
    expect(NeedsTranslation(FORMATS.GEMINI, FORMATS.OPENAI)).toBe(true);
    expect(NeedsTranslation(FORMATS.OPENAI, FORMATS.GEMINI)).toBe(true);
    expect(NeedsTranslation(FORMATS.OPENAI, FORMATS.OLLAMA)).toBe(true);
    expect(NeedsTranslation(FORMATS.OLLAMA, FORMATS.OPENAI)).toBe(true);
  });
});

// ─── Request Registry ──────────────────────────────────────────────────────────

describe("Request registry", () => {
  it("translates OpenAI → Claude request", () => {
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true };
    const result = JSON.parse(dec.decode(Request(FORMATS.OPENAI, FORMATS.CLAUDE, "claude-sonnet-4", enc.encode(JSON.stringify(body)), true)));
    expect(result.model).toBe("claude-sonnet-4");
    expect(result.messages).toBeDefined();
  });

  it("translates Claude → OpenAI request", () => {
    const body = { model: "claude-sonnet-4", messages: [{ role: "user", content: "hi" }], stream: true };
    const result = JSON.parse(dec.decode(Request(FORMATS.CLAUDE, FORMATS.OPENAI, "gpt-4o", enc.encode(JSON.stringify(body)), true)));
    expect(result.model).toBe("gpt-4o");
    expect(result.messages).toBeDefined();
  });

  it("translates Gemini → OpenAI request", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    const result = JSON.parse(dec.decode(Request(FORMATS.GEMINI, FORMATS.OPENAI, "gpt-4o", enc.encode(JSON.stringify(body)), true)));
    expect(result.model).toBe("gpt-4o");
    expect(result.messages).toBeDefined();
  });

  it("translates OpenAI → Gemini request", () => {
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true };
    const result = JSON.parse(dec.decode(Request(FORMATS.OPENAI, FORMATS.GEMINI, "gemini-2.0-flash", enc.encode(JSON.stringify(body)), true)));
    // OpenAI→Gemini puts messages into contents array
    expect(result.contents).toBeDefined();
    expect(result.stream).toBe(true);
  });

  it("translates Claude → Ollama request", () => {
    const body = { model: "claude-sonnet-4", messages: [{ role: "user", content: "hi" }] };
    const result = JSON.parse(dec.decode(Request(FORMATS.CLAUDE, FORMATS.OLLAMA, "llama3", enc.encode(JSON.stringify(body)), true)));
    expect(result.model).toBe("llama3");
  });

  it("translates Ollama → Claude request", () => {
    const body = { model: "llama3", messages: [{ role: "user", content: "hi" }] };
    const result = JSON.parse(dec.decode(Request(FORMATS.OLLAMA, FORMATS.CLAUDE, "claude-sonnet-4", enc.encode(JSON.stringify(body)), true)));
    expect(result.model).toBe("claude-sonnet-4");
  });

  it("translates Ollama → OpenAI request", () => {
    const body = { model: "llama3", messages: [{ role: "user", content: "hi" }], options: { temperature: 0.7 } };
    const result = JSON.parse(dec.decode(Request(FORMATS.OLLAMA, FORMATS.OPENAI, "gpt-4o", enc.encode(JSON.stringify(body)), true)));
    expect(result.model).toBe("gpt-4o");
    expect(result.temperature).toBe(0.7);
  });

  it("translates OpenAI → Ollama request", () => {
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };
    const result = JSON.parse(dec.decode(Request(FORMATS.OPENAI, FORMATS.OLLAMA, "llama3", enc.encode(JSON.stringify(body)), true)));
    expect(result.model).toBe("llama3");
  });

  it("passes through for identity (same format)", () => {
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "test" }] };
    const raw = enc.encode(JSON.stringify(body));
    const result = Request(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", raw, true);
    const parsed = JSON.parse(dec.decode(result));
    expect(parsed.model).toBe("gpt-4o");
    expect(parsed.messages).toEqual(body.messages);
  });

  it("returns input unchanged for unknown pair", () => {
    const body = { model: "test" };
    const raw = enc.encode(JSON.stringify(body));
    const result = Request("unknown_format", FORMATS.OPENAI, "test", raw, true);
    expect(dec.decode(result)).toBe(JSON.stringify(body));
  });
});

// ─── ResponseNonStream Registry ────────────────────────────────────────────────

describe("ResponseNonStream registry", () => {
  const NO_RAW = new Uint8Array(0);

  it("passes through for identity (same format)", () => {
    const body = { id: "test", result: "passthrough" };
    const raw = enc.encode(JSON.stringify(body));
    const result = ResponseNonStream(FORMATS.OPENAI, FORMATS.OPENAI, null, "gpt-4o", NO_RAW, NO_RAW, raw);
    expect(JSON.parse(dec.decode(result))).toEqual(body);
  });

  it("returns raw for unknown pair", () => {
    const body = { id: "test" };
    const raw = enc.encode(JSON.stringify(body));
    const result = ResponseNonStream("unknown_from", "unknown_to", null, "model", NO_RAW, NO_RAW, raw);
    expect(dec.decode(result)).toBe(JSON.stringify(body));
  });

  it("translates Gemini non-streaming response to OpenAI", () => {
    const geminiResp = {
      candidates: [{ content: { parts: [{ text: "Hello" }], role: "model" }, finishReason: "STOP" }],
      usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
    };
    const raw = enc.encode(JSON.stringify(geminiResp));
    const result = JSON.parse(dec.decode(ResponseNonStream(FORMATS.GEMINI, FORMATS.OPENAI, null, "gemini-2.0-flash", NO_RAW, NO_RAW, raw)));
    expect(result.choices).toBeDefined();
    expect(result.choices[0].message.content).toBe("Hello");
  });
});

// ─── initTranslators ───────────────────────────────────────────────────────────

describe("initTranslators", () => {
  it("does not throw when called", () => {
    expect(() => initTranslators()).not.toThrow();
  });

  it("does not break Request after being called", () => {
    initTranslators();
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };
    const result = Request(FORMATS.OPENAI, FORMATS.OPENAI, "gpt-4o", enc.encode(JSON.stringify(body)), true);
    const parsed = JSON.parse(dec.decode(result));
    expect(parsed.model).toBe("gpt-4o");
  });
});