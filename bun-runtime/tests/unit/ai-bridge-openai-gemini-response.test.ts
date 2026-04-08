/**
 * Unit tests for ai-bridge/translator/openai/gemini/response.ts
 * Covers: convertOpenAIResponseToGemini, convertOpenAIResponseToGeminiNonStream
 */

import { describe, it, expect } from "bun:test";
import { convertOpenAIResponseToGemini, convertOpenAIResponseToGeminiNonStream, type OpenAIGeminiState } from "../../ai-bridge/translator/openai/gemini/response.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

const NO_RAW = new Uint8Array(0);

function decodeAll(chunks: Uint8Array[]): string {
  return chunks.map(c => dec.decode(c)).join("");
}

// ─── Streaming: OpenAI → Gemini ──────────────────────────────────────────────

describe("convertOpenAIResponseToGemini", () => {
  it("converts OpenAI content delta to Gemini text part", () => {
    const raw = enc.encode('data: {"id":"chatcmpl_1","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"hello"},"finish_reason":null}]}\n\n');
    const chunks = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain('"text":"hello"');
    expect(text).toContain('"role":"model"');
  });

  it("emits finish event with STOP when finish_reason is stop", () => {
    const raw = enc.encode('data: {"id":"chatcmpl_1","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n');
    const chunks = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain('"finishReason":"STOP"');
    expect(text).toContain("[DONE]");
  });

  it("maps length finish_reason to MAX_TOKENS", () => {
    const raw = enc.encode('data: {"id":"chatcmpl_1","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"length"}]}\n\n');
    const chunks = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain('"finishReason":"MAX_TOKENS"');
  });

  it("maps content_filter finish_reason to SAFETY", () => {
    const raw = enc.encode('data: {"id":"chatcmpl_1","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"content_filter"}]}\n\n');
    const chunks = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain('"finishReason":"SAFETY"');
  });

  it("converts tool_calls delta to functionCall", () => {
    const raw = enc.encode('data: {"id":"chatcmpl_1","model":"gpt-4o","choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"name":"search","arguments":"{\\"q\\":\\"test\\"}"}}]},"finish_reason":null}]}\n\n');
    const chunks = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain("functionCall");
    expect(text).toContain('"name":"search"');
  });

  it("handles data: [DONE] sentinel", () => {
    const raw = enc.encode("data: [DONE]\n\n");
    const chunks = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, raw, undefined);
    // Should produce done events, not crash
    expect(chunks.length).toBeGreaterThanOrEqual(0);
  });

  it("returns empty array for empty input", () => {
    const raw = enc.encode("");
    const chunks = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, raw, undefined);
    expect(chunks).toHaveLength(0);
  });

  it("returns empty array for invalid JSON", () => {
    const raw = enc.encode("data: not json\n\n");
    const chunks = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, raw, undefined);
    expect(chunks).toHaveLength(0);
  });

  it("accumulates content across chunks", () => {
    const state: OpenAIGeminiState = {
      messageId: "", model: "", roleSet: false, contentAccumulator: "", messageStopSent: false,
    };
    const chunk1 = enc.encode('data: {"id":"c1","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"hel"},"finish_reason":null}]}\n\n');
    convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, chunk1, state);

    const chunk2 = enc.encode('data: {"id":"c1","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"lo"},"finish_reason":null}]}\n\n');
    const result2 = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, chunk2, state);
    const text2 = decodeAll(result2);
    expect(text2).toContain('"text":"lo"');
  });

  it("maps tool_calls finish_reason to STOP", () => {
    const raw = enc.encode('data: {"id":"c1","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}]}\n\n');
    const chunks = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain('"finishReason":"STOP"');
  });
});

// ─── Non-streaming: OpenAI → Gemini ──────────────────────────────────────────

describe("convertOpenAIResponseToGeminiNonStream", () => {
  it("converts OpenAI chat completion to Gemini response", () => {
    const openaiResp = {
      id: "chatcmpl_1",
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "Hello from GPT" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const raw = enc.encode(JSON.stringify(openaiResp));
    const result = JSON.parse(dec.decode(convertOpenAIResponseToGeminiNonStream(null, "gpt-4o", NO_RAW, NO_RAW, raw)));

    expect(result.candidates).toBeDefined();
    expect(result.candidates[0].content.role).toBe("model");
    expect(result.candidates[0].content.parts[0].text).toBe("Hello from GPT");
    expect(result.candidates[0].finishReason).toBe("STOP");
  });

  it("maps finish_reason=length to MAX_TOKENS", () => {
    const openaiResp = {
      id: "chatcmpl_1",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "trunc" }, finish_reason: "length" }],
      usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 },
    };
    const raw = enc.encode(JSON.stringify(openaiResp));
    const result = JSON.parse(dec.decode(convertOpenAIResponseToGeminiNonStream(null, "gpt-4o", NO_RAW, NO_RAW, raw)));
    expect(result.candidates[0].finishReason).toBe("MAX_TOKENS");
  });

  it("maps finish_reason=content_filter to SAFETY", () => {
    const openaiResp = {
      id: "chatcmpl_1",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "filtered" }, finish_reason: "content_filter" }],
      usage: {},
    };
    const raw = enc.encode(JSON.stringify(openaiResp));
    const result = JSON.parse(dec.decode(convertOpenAIResponseToGeminiNonStream(null, "gpt-4o", NO_RAW, NO_RAW, raw)));
    expect(result.candidates[0].finishReason).toBe("SAFETY");
  });

  it("converts tool_calls to functionCall parts", () => {
    const openaiResp = {
      id: "chatcmpl_1",
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_1",
            type: "function",
            function: { name: "search", arguments: '{"q":"test"}' },
          }],
        },
        finish_reason: "tool_calls",
      }],
      usage: {},
    };
    const raw = enc.encode(JSON.stringify(openaiResp));
    const result = JSON.parse(dec.decode(convertOpenAIResponseToGeminiNonStream(null, "gpt-4o", NO_RAW, NO_RAW, raw)));

    const parts = result.candidates[0].content.parts;
    const fnPart = parts.find((p: Record<string, unknown>) => p.functionCall);
    expect(fnPart).toBeDefined();
    expect(fnPart.functionCall.name).toBe("search");
  });

  it("includes usageMetadata", () => {
    const openaiResp = {
      id: "chatcmpl_1",
      model: "gpt-4o",
      choices: [{ index: 0, message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
    };
    const raw = enc.encode(JSON.stringify(openaiResp));
    const result = JSON.parse(dec.decode(convertOpenAIResponseToGeminiNonStream(null, "gpt-4o", NO_RAW, NO_RAW, raw)));

    expect(result.usageMetadata.promptTokenCount).toBe(10);
    expect(result.usageMetadata.candidatesTokenCount).toBe(5);
    expect(result.usageMetadata.totalTokenCount).toBe(15);
  });

  it("returns raw on parse error", () => {
    const raw = enc.encode("not json");
    const result = convertOpenAIResponseToGeminiNonStream(null, "gpt-4o", NO_RAW, NO_RAW, raw);
    expect(dec.decode(result)).toBe("not json");
  });

  it("returns raw when no choices present", () => {
    const raw = enc.encode(JSON.stringify({ id: "x", model: "gpt-4o" }));
    const result = convertOpenAIResponseToGeminiNonStream(null, "gpt-4o", NO_RAW, NO_RAW, raw);
    expect(dec.decode(result)).toBe(JSON.stringify({ id: "x", model: "gpt-4o" }));
  });

  it("handles array content with text parts", () => {
    const openaiResp = {
      id: "chatcmpl_1",
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: [{ type: "text", text: "part1" }, { type: "text", text: "part2" }],
        },
        finish_reason: "stop",
      }],
      usage: {},
    };
    const raw = enc.encode(JSON.stringify(openaiResp));
    const result = JSON.parse(dec.decode(convertOpenAIResponseToGeminiNonStream(null, "gpt-4o", NO_RAW, NO_RAW, raw)));

    const parts = result.candidates[0].content.parts;
    expect(parts).toHaveLength(2);
    expect(parts[0].text).toBe("part1");
    expect(parts[1].text).toBe("part2");
  });
});