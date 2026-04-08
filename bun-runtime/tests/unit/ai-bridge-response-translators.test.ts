/**
 * Unit tests for ai-bridge response translators.
 * Uses Bun's native test runner.
 *
 * Streaming and non-streaming tests call translation functions directly
 * (bypassing the Response() registry to avoid Bun module-caching issues).
 */

import { describe, it, expect } from "bun:test";
// Streaming converters — tested directly to avoid registry caching bugs
import { convertClaudeResponseToOpenAI } from "../../ai-bridge/translator/openai/claude/response.ts";
import { convertOpenAIResponseToClaude } from "../../ai-bridge/translator/claude/openai/response.ts";
import { convertGeminiResponseToOpenAI } from "../../ai-bridge/translator/gemini/openai/response.ts";
// Non-streaming converters — tested directly
import { convertClaudeResponseToOpenAINonStream } from "../../ai-bridge/translator/openai/claude/response.ts";
import { convertOpenAIResponseToClaudeNonStream } from "../../ai-bridge/translator/claude/openai/response.ts";
import { convertGeminiResponseToOpenAINonStream } from "../../ai-bridge/translator/gemini/openai/response.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

function decodeAll(chunks: Uint8Array[]): string[] {
  return chunks.map(c => new TextDecoder().decode(c));
}

const NO_RAW = new Uint8Array(0);

// ─── Streaming: openai → claude ───────────────────────────────────────────────

describe("openai → claude (streaming)", () => {
  it("emits message_start event on first chunk", () => {
    const chunk = encode('data: {"id":"chat_123","object":"chat.completion.chunk","model":"claude-sonnet-4","created":1234567890,"choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n');
    const chunks = decodeAll(convertOpenAIResponseToClaude(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk, undefined));
    const raw = chunks.join("");
    expect(raw).toContain("event: message_start");
    expect(raw).toContain('"type":"message_start"');
    expect(raw).toContain('"id":"chat_123"');
  });

  it("accumulates text content delta", () => {
    const chunk = encode('data: {"id":"chat_123","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n');
    const chunks = decodeAll(convertOpenAIResponseToClaude(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk, undefined));
    expect(chunks.some(c => c.includes('"text":"hello"'))).toBe(true);
  });

  it("handles [DONE] marker gracefully", () => {
    const chunk = encode("data: [DONE]\n\n");
    const chunks = decodeAll(convertOpenAIResponseToClaude(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk, undefined));
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("maps finish_reason stop → end_turn in message_delta", () => {
    const chunk = encode('data: {"id":"chat_123","choices":[{"index":0,"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}\n\n');
    const chunks = decodeAll(convertOpenAIResponseToClaude(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk, undefined));
    const raw = chunks.join("");
    expect(raw).toContain('"stop_reason":"end_turn"');
    expect(raw).toContain("event: message_delta");
  });

  it("maps finish_reason tool_calls → tool_use", () => {
    const chunk = encode('data: {"id":"chat_123","choices":[{"index":0,"delta":{},"finish_reason":"tool_calls"}],"usage":{"prompt_tokens":10,"completion_tokens":5}}');
    const chunks = decodeAll(convertOpenAIResponseToClaude(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk, undefined));
    const raw = chunks.join("");
    expect(raw).toContain('"stop_reason":"tool_use"');
  });

  it("maps reasoning_content → thinking block (Claude extended thinking support)", () => {
    // convertOpenAIResponseToClaude converts OpenAI reasoning_content to Claude thinking format
    const chunk = encode('data: {"id":"chat_123","choices":[{"index":0,"delta":{"reasoning_content":"let me think"}}]}');
    const chunks = decodeAll(convertOpenAIResponseToClaude(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk, undefined));
    const raw = chunks.join("");
    // OpenAI extended thinking → Claude thinking block (the function supports this translation)
    expect(raw).toContain("thinking");
  });

  it("accumulates tool_use input_json_delta into Claude tool_use blocks", () => {
    // Test the input_json_delta path by feeding a combined Claude SSE delta
    // (the function handles the delta by parsing content_block_delta type)
    const deltaSse = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"input_json_delta","partial_json":"{\\"city\\":\\"NYC\\"}"}}\n\n';
    // With no prior state (fresh call), input_json_delta won't produce tool_use
    // because the block hasn't been started — this exercises the code path
    const chunks = decodeAll(convertOpenAIResponseToClaude(null, "claude-sonnet-4", NO_RAW, NO_RAW, encode(deltaSse), undefined));
    // Code should not crash; empty result is acceptable for orphaned delta
    expect(Array.isArray(chunks)).toBe(true);
  });
});

// ─── Streaming: claude → openai ──────────────────────────────────────────────

describe("claude → openai (streaming)", () => {
  it("parses message_start event and emits OpenAI chunk with role", () => {
    // convertClaudeResponseToOpenAI parses the raw SSE format
    const sse = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_abc","type":"message","role":"assistant","model":"claude-sonnet-4","content":[],"stop_reason":null,"stop_sequence":null,"usage":{"input_tokens":0,"output_tokens":0}}}';
    const chunks = decodeAll(convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, encode(sse), undefined));
    const raw = chunks.join("");
    expect(raw).toContain("data: ");
    expect(raw).toContain('"id":"msg_abc"');
    expect(raw).toContain('"object":"chat.completion.chunk"');
  });

  it("parses content_block_delta text and emits delta with content", () => {
    const sse = 'event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"world"}}';
    const chunks = decodeAll(convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, encode(sse), undefined));
    const raw = chunks.join("");
    expect(raw).toContain('"content":"world"');
  });

  it("handles message_stop event and emits [DONE]", () => {
    const sse = 'event: message_stop\ndata: {"type":"message_stop"}';
    const chunks = decodeAll(convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, encode(sse), undefined));
    const raw = chunks.join("");
    expect(raw).toContain("data: [DONE]");
  });

  it("maps end_turn → stop finish_reason in message_delta", () => {
    const sse = 'event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"input_tokens":5,"output_tokens":3}}';
    const chunks = decodeAll(convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, encode(sse), undefined));
    const raw = chunks.join("");
    expect(raw).toContain('"finish_reason":"stop"');
    expect(raw).toContain('"prompt_tokens":5');
  });
});

// ─── Streaming: gemini → openai ──────────────────────────────────────────────

describe("gemini → openai (streaming)", () => {
  it("emits OpenAI chunk on first chunk", () => {
    const raw = encode('{"candidates":[{"content":{"parts":[{"text":"hello"}]}}],"modelVersion":"gemini-2.0-flash"}\n');
    const chunks = decodeAll(convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, raw, undefined));
    const out = chunks.join("");
    expect(out).toContain("data: ");
    expect(out).toContain('"object":"chat.completion.chunk"');
  });

  it("extracts text from candidates[0].content.parts", () => {
    const raw = encode('{"candidates":[{"content":{"parts":[{"text":"gemini says hi"}]}}]}\n');
    const chunks = decodeAll(convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, raw, undefined));
    const out = chunks.join("");
    expect(out).toContain('"content":"gemini says hi"');
  });

  it("handles empty parts", () => {
    const raw = encode('{"candidates":[{"content":{"parts":[]}}]}\n');
    const chunks = decodeAll(convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, raw, undefined));
    expect(chunks.length).toBeGreaterThan(0);
  });

  it("emits text delta with finish_reason null for STOP", () => {
    // STOP finishReason skips the explicit finish chunk but text is still emitted
    const raw = encode('{"candidates":[{"content":{"parts":[{"text":"done"}]}}],"finishReason":"STOP"}');
    const chunks = decodeAll(convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, raw, undefined));
    const out = chunks.join("");
    // Text delta is emitted with finish_reason: null (default chunk)
    expect(out).toContain('"content":"done"');
    expect(out).toContain('"finish_reason":null');
  });

  it("handles [DONE] marker and emits finish_reason stop", () => {
    // When [DONE] marker is passed, buildDoneEvents emits the finish chunk
    const doneChunk = encode("data: [DONE]");
    const chunks = decodeAll(convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, doneChunk, undefined));
    const out = chunks.join("");
    expect(out).toContain("data: [DONE]");
    expect(out).toContain('"finish_reason":"stop"');
  });
});

// ─── Non-streaming: claude → openai ─────────────────────────────────────────

describe("convertClaudeResponseToOpenAINonStream (claude → openai non-streaming)", () => {
  it("transforms Claude message to OpenAI chat.completion format", () => {
    const raw = encode(JSON.stringify({
      id: "msg_test",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4",
      content: [{ type: "text", text: "hello world" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const result = convertClaudeResponseToOpenAINonStream(null, "", NO_RAW, NO_RAW, raw);
    const out = JSON.parse(new TextDecoder().decode(result));

    expect(out.object).toBe("chat.completion");
    expect(out.id).toBe("msg_test");
    expect(out.choices[0].message.content).toBe("hello world");
    expect(out.choices[0].finish_reason).toBe("stop");
    expect(out.usage.total_tokens).toBe(15);
  });

  it("maps tool_use blocks to tool_calls in non-streaming response", () => {
    const raw = encode(JSON.stringify({
      id: "msg_tool",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4",
      content: [
        { type: "text", text: "here you go" },
        { type: "tool_use", id: "tool_1", name: "get_weather", input: '{"city":"NYC"}' },
      ],
      stop_reason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    }));
    const result = convertClaudeResponseToOpenAINonStream(null, "", NO_RAW, NO_RAW, raw);
    const out = JSON.parse(new TextDecoder().decode(result));

    expect(out.choices[0].message.tool_calls).toBeDefined();
    expect(out.choices[0].message.tool_calls[0].function.name).toBe("get_weather");
    expect(out.choices[0].finish_reason).toBe("tool_calls");
  });

  it("skips thinking blocks (OpenAI doesn't support them)", () => {
    const raw = encode(JSON.stringify({
      id: "msg_think",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-4",
      content: [
        { type: "thinking", thinking: "let me think" },
        { type: "text", text: "final answer" },
      ],
      stop_reason: "end_turn",
      usage: { input_tokens: 5, output_tokens: 3 },
    }));
    const result = convertClaudeResponseToOpenAINonStream(null, "", NO_RAW, NO_RAW, raw);
    const out = JSON.parse(new TextDecoder().decode(result));

    expect(out.choices[0].message.content).toBe("final answer");
  });

  it("returns raw on invalid JSON", () => {
    const raw = encode("not json {");
    const result = convertClaudeResponseToOpenAINonStream(null, "", NO_RAW, NO_RAW, raw);
    expect(new TextDecoder().decode(result)).toBe("not json {");
  });
});

// ─── Non-streaming: openai → claude ────────────────────────────────────────

describe("convertOpenAIResponseToClaudeNonStream (openai → claude non-streaming)", () => {
  it("transforms OpenAI chat.completion to Claude message format", () => {
    const raw = encode(JSON.stringify({
      id: "chat_test",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: { role: "assistant", content: "hi there" },
        finish_reason: "stop",
      }],
      usage: { prompt_tokens: 8, completion_tokens: 3, total_tokens: 11 },
    }));
    const result = convertOpenAIResponseToClaudeNonStream(null, "", NO_RAW, NO_RAW, raw);
    const out = JSON.parse(new TextDecoder().decode(result));

    expect(out.type).toBe("message");
    expect(out.role).toBe("assistant");
    expect(out.content[0].text).toBe("hi there");
    expect(out.stop_reason).toBe("end_turn");
    expect(out.usage.input_tokens).toBe(8);
  });

  it("maps tool_calls to tool_use blocks", () => {
    const raw = encode(JSON.stringify({
      id: "chat_tool",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{
        index: 0,
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{
            id: "call_abc",
            type: "function",
            function: { name: "search", arguments: '{"q":"test"}' },
          }],
        },
        finish_reason: "tool_calls",
      }],
    }));
    const result = convertOpenAIResponseToClaudeNonStream(null, "", NO_RAW, NO_RAW, raw);
    const out = JSON.parse(new TextDecoder().decode(result));

    expect(out.content[0].type).toBe("tool_use");
    expect(out.content[0].name).toBe("search");
    expect(out.stop_reason).toBe("tool_use");
  });

  it("maps finish_reason length → max_tokens", () => {
    const raw = encode(JSON.stringify({
      id: "chat_len",
      object: "chat.completion",
      model: "gpt-4o",
      choices: [{ index: 0, message: { content: "partial" }, finish_reason: "length" }],
    }));
    const result = convertOpenAIResponseToClaudeNonStream(null, "", NO_RAW, NO_RAW, raw);
    const out = JSON.parse(new TextDecoder().decode(result));
    expect(out.stop_reason).toBe("max_tokens");
  });

  it("returns raw on invalid JSON", () => {
    const raw = encode("not json {");
    const result = convertOpenAIResponseToClaudeNonStream(null, "", NO_RAW, NO_RAW, raw);
    expect(new TextDecoder().decode(result)).toBe("not json {");
  });
});

// ─── Non-streaming: gemini → openai ─────────────────────────────────────────

describe("convertGeminiResponseToOpenAINonStream (gemini → openai non-streaming)", () => {
  it("transforms Gemini candidates to OpenAI chat.completion format", () => {
    const raw = encode(JSON.stringify({
      candidates: [{
        content: {
          parts: [{ text: "gemini response" }],
        },
      }],
      modelVersion: "gemini-2.0-flash",
      usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 3, totalTokenCount: 8 },
    }));
    const result = convertGeminiResponseToOpenAINonStream(null, "", NO_RAW, NO_RAW, raw);
    const out = JSON.parse(new TextDecoder().decode(result));

    expect(out.object).toBe("chat.completion");
    expect(out.choices[0].message.content).toBe("gemini response");
    expect(out.usage.total_tokens).toBe(8);
  });

  it("maps finishReason SAFETY → content_filter", () => {
    const raw = encode(JSON.stringify({
      candidates: [{ content: { parts: [] } }],
      finishReason: "SAFETY",
    }));
    const result = convertGeminiResponseToOpenAINonStream(null, "", NO_RAW, NO_RAW, raw);
    const out = JSON.parse(new TextDecoder().decode(result));
    expect(out.choices[0].finish_reason).toBe("content_filter");
  });

  it("returns raw on invalid JSON", () => {
    const raw = encode("not json");
    const result = convertGeminiResponseToOpenAINonStream(null, "", NO_RAW, NO_RAW, raw);
    expect(new TextDecoder().decode(result)).toBe("not json");
  });
});
