/**
 * Unit tests for Ollama translators
 * Covers: convertClaudeRequestToOllama, convertOllamaRequestToClaude,
 * convertOllamaResponseToClaude, convertOllamaResponseToClaudeNonStream,
 * convertOllamaRequestToOpenAI, convertOpenAIRequestToOllama
 */

import { describe, it, expect } from "bun:test";
import { convertClaudeRequestToOllama } from "../../ai-bridge/translator/claude/ollama/request.ts";
import { convertOllamaRequestToClaude } from "../../ai-bridge/translator/ollama/claude/request.ts";
import { convertOllamaResponseToClaude, convertOllamaResponseToClaudeNonStream, type OllamaStreamingState } from "../../ai-bridge/translator/ollama/claude/response.ts";
import { convertOllamaRequestToOpenAI } from "../../ai-bridge/translator/ollama/openai/request.ts";
import { convertOpenAIRequestToOllama } from "../../ai-bridge/translator/openai/ollama/request.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();

function encode(obj: object): Uint8Array {
  return enc.encode(JSON.stringify(obj));
}

function decode(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(dec.decode(bytes));
}

// ─── Claude → Ollama request ──────────────────────────────────────────────────

describe("convertClaudeRequestToOllama", () => {
  it("translates basic Claude request with system and messages", () => {
    const result = decode(convertClaudeRequestToOllama("llama3", encode({
      system: "You are helpful",
      messages: [{ role: "user", content: "hello" }],
      max_tokens: 100,
      temperature: 0.7,
    }), true));

    expect(result.model).toBe("llama3");
    expect(result.stream).toBe(true);
    const options = result.options as Record<string, unknown>;
    expect(options.num_predict).toBe(100);
    expect(options.temperature).toBe(0.7);

    const messages = result.messages as Array<Record<string, unknown>>;
    expect(messages[0].role).toBe("system");
    expect(messages[1].role).toBe("user");
  });

  it("converts stop_sequences to stop", () => {
    const result = decode(convertClaudeRequestToOllama("llama3", encode({
      messages: [{ role: "user", content: "hi" }],
      stop_sequences: ["STOP"],
    }), false));
    expect(result.stop).toBe("STOP");
  });

  it("converts array stop_sequences to array stop", () => {
    const result = decode(convertClaudeRequestToOllama("llama3", encode({
      messages: [{ role: "user", content: "hi" }],
      stop_sequences: ["STOP", "END"],
    }), false));
    expect(Array.isArray(result.stop)).toBe(true);
    expect((result.stop as string[]).length).toBe(2);
  });

  it("converts tool_use content to text", () => {
    const result = decode(convertClaudeRequestToOllama("llama3", encode({
      messages: [{
        role: "assistant",
        content: [{ type: "tool_use", id: "t1", name: "search", input: { q: "test" } }],
      }],
    }), true));
    const messages = result.messages as Array<Record<string, unknown>>;
    expect(messages[0].content).toContain("TOOL_CALL");
    expect(messages[0].content).toContain("search");
  });

  it("converts tool_result content to text", () => {
    const result = decode(convertClaudeRequestToOllama("llama3", encode({
      messages: [{
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "t1", content: "result text" }],
      }],
    }), true));
    const messages = result.messages as Array<Record<string, unknown>>;
    expect(messages[0].content).toContain("TOOL_RESULT");
  });

  it("converts tools to text description appended to system", () => {
    const result = decode(convertClaudeRequestToOllama("llama3", encode({
      system: "Be helpful",
      messages: [{ role: "user", content: "hi" }],
      tools: [{ name: "search", description: "Search the web" }],
    }), true));
    const messages = result.messages as Array<Record<string, unknown>>;
    const systemMsg = messages[0];
    expect((systemMsg.content as string)).toContain("search");
    expect((systemMsg.content as string)).toContain("Search the web");
  });

  it("converts Claude image to placeholder text", () => {
    const result = decode(convertClaudeRequestToOllama("llama3", encode({
      messages: [{
        role: "user",
        content: [{
          type: "image",
          source: { type: "base64", media_type: "image/png", data: "abc123" },
        }],
      }],
    }), true));
    const messages = result.messages as Array<Record<string, unknown>>;
    expect(messages[0].content).toContain("[image:");
  });
});

// ─── Ollama → Claude request ──────────────────────────────────────────────────

describe("convertOllamaRequestToClaude", () => {
  it("translates basic Ollama request", () => {
    const result = decode(convertOllamaRequestToClaude("claude-sonnet-4", encode({
      model: "llama3",
      messages: [{ role: "user", content: "hello" }],
      system: "Be helpful",
      options: { temperature: 0.5, num_predict: 200 },
      stream: true,
    })));

    expect(result.model).toBe("claude-sonnet-4");
    expect(result.temperature).toBe(0.5);
    expect(result.max_tokens).toBe(200);
    expect(result.stream).toBe(true);
    expect(result.system).toBe("Be helpful");
    const messages = result.messages as Array<Record<string, unknown>>;
    expect(messages[0].role).toBe("user");
  });

  it("converts stop to stop_sequences", () => {
    const result = decode(convertOllamaRequestToClaude("claude-sonnet-4", encode({
      messages: [{ role: "user", content: "hi" }],
      stop: "END",
    })));
    expect(result.stop_sequences).toEqual(["END"]);
  });

  it("converts array stop to stop_sequences", () => {
    const result = decode(convertOllamaRequestToClaude("claude-sonnet-4", encode({
      messages: [{ role: "user", content: "hi" }],
      stop: ["END", "STOP"],
    })));
    expect(result.stop_sequences).toEqual(["END", "STOP"]);
  });
});

// ─── Ollama → Claude response (streaming) ────────────────────────────────────

describe("convertOllamaResponseToClaude", () => {
  const NO_RAW = new Uint8Array(0);

  function decodeAll(chunks: Uint8Array[]): string {
    return chunks.map(c => dec.decode(c)).join("");
  }

  it("emits message_start on first chunk", () => {
    const raw = enc.encode('data: {"model":"llama3","message":{"role":"assistant","content":"hi"}}\n\n');
    const chunks = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain("event: message_start");
  });

  it("emits content_block_start and content_block_delta for text content", () => {
    const raw = enc.encode('data: {"model":"llama3","message":{"role":"assistant","content":"hello"}}\n\n');
    const chunks = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain("event: content_block_start");
    expect(text).toContain("event: content_block_delta");
    expect(text).toContain("text_delta");
  });

  it("emits message_delta and message_stop on done=true", () => {
    const raw = enc.encode('data: {"model":"llama3","done":true,"done_reason":"stop"}\n\n');
    const chunks = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain("event: message_delta");
    expect(text).toContain("event: message_stop");
    expect(text).toContain('"stop_reason":"end_turn"');
  });

  it("maps done_reason=length to max_tokens", () => {
    const raw = enc.encode('data: {"model":"llama3","done":true,"done_reason":"length"}\n\n');
    const chunks = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain('"stop_reason":"max_tokens"');
  });

  it("handles [DONE] sentinel", () => {
    const raw = enc.encode("data: [DONE]\n\n");
    const chunks = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, raw, undefined);
    const text = decodeAll(chunks);
    expect(text).toContain("event: message_stop");
  });

  it("returns empty array for empty input", () => {
    const raw = enc.encode("");
    const chunks = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, raw, undefined);
    expect(chunks).toHaveLength(0);
  });

  it("accumulates state across multiple chunks", () => {
    // Create a state object that will be mutated in-place
    const state: OllamaStreamingState = {
      messageId: "", model: "", textBlockStarted: false, textBlockIndex: -1,
      nextBlockIndex: 0, messageStarted: false, messageStopSent: false, contentAccumulator: "",
    };
    const chunk1 = enc.encode('data: {"model":"llama3","message":{"role":"assistant","content":"hel"}}\n\n');
    const result1 = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, chunk1, state);

    const chunk2 = enc.encode('data: {"model":"llama3","message":{"role":"assistant","content":"lo"}}\n\n');
    const result2 = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, chunk2, state);
    const text2 = decodeAll(result2);
    // Second chunk should not emit message_start again (state tracks)
    expect(text2).not.toContain("event: message_start");
    expect(text2).toContain("event: content_block_delta");
  });
});

// ─── Ollama → Claude response (non-streaming) ─────────────────────────────────

describe("convertOllamaResponseToClaudeNonStream", () => {
  it("converts Ollama JSON response to Claude format", () => {
    const raw = enc.encode(JSON.stringify({
      model: "llama3",
      message: { role: "assistant", content: "Hello world" },
      done: true,
      done_reason: "stop",
    }));
    const result = decode(convertOllamaResponseToClaudeNonStream(null, "llama3", raw, raw, raw));

    expect(result.type).toBe("message");
    expect(result.role).toBe("assistant");
    const content = result.content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("Hello world");
    expect(result.stop_reason).toBe("end_turn");
  });

  it("maps done_reason=length to max_tokens", () => {
    const raw = enc.encode(JSON.stringify({
      model: "llama3",
      message: { role: "assistant", content: "truncated" },
      done: true,
      done_reason: "length",
    }));
    const result = decode(convertOllamaResponseToClaudeNonStream(null, "llama3", raw, raw, raw));
    expect(result.stop_reason).toBe("max_tokens");
  });

  it("returns raw on parse error", () => {
    const raw = enc.encode("not json");
    const result = convertOllamaResponseToClaudeNonStream(null, "llama3", raw, raw, raw);
    expect(dec.decode(result)).toBe("not json");
  });
});

// ─── Ollama → OpenAI request ──────────────────────────────────────────────────

describe("convertOllamaRequestToOpenAI", () => {
  it("translates Ollama request to OpenAI format", () => {
    const result = decode(convertOllamaRequestToOpenAI("gpt-4o", encode({
      model: "llama3",
      messages: [{ role: "user", content: "hi" }],
      options: { temperature: 0.7, top_p: 0.9, num_predict: 100 },
      stop: ["END"],
    }), true));

    expect(result.model).toBe("gpt-4o");
    expect(result.stream).toBe(true);
    expect(result.temperature).toBe(0.7);
    expect(result.top_p).toBe(0.9);
    expect(result.max_tokens).toBe(100);
    expect(result.stop).toEqual(["END"]);
  });

  it("copies messages and system", () => {
    const result = decode(convertOllamaRequestToOpenAI("gpt-4o", encode({
      messages: [{ role: "user", content: "hi" }],
      system: "Be helpful",
    }), false));
    expect(result.messages).toBeDefined();
    expect(result.system).toBe("Be helpful");
  });

  it("copies tools if present", () => {
    const result = decode(convertOllamaRequestToOpenAI("gpt-4o", encode({
      messages: [{ role: "user", content: "hi" }],
      tools: [{ type: "function", function: { name: "search" } }],
    }), true));
    expect(result.tools).toBeDefined();
  });
});

// ─── OpenAI → Ollama request ──────────────────────────────────────────────────

describe("convertOpenAIRequestToOllama", () => {
  it("translates OpenAI request to Ollama format", () => {
    const result = decode(convertOpenAIRequestToOllama("llama3", encode({
      model: "gpt-4o",
      messages: [
        { role: "system", content: "You are helpful" },
        { role: "user", content: "hi" },
      ],
      temperature: 0.7,
      max_tokens: 100,
    }), true));

    expect(result.model).toBe("llama3");
    expect(result.stream).toBe(true);
    expect(result.system).toBe("You are helpful");
    // System messages should be extracted from messages array
    const messages = result.messages as Array<Record<string, unknown>>;
    expect(messages.every(m => m.role !== "system")).toBe(true);
    expect(messages.some(m => m.role === "user")).toBe(true);
    const options = result.options as Record<string, unknown>;
    expect(options.temperature).toBe(0.7);
    expect(options.num_predict).toBe(100);
  });

  it("handles request without system message", () => {
    const result = decode(convertOpenAIRequestToOllama("llama3", encode({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    }), false));
    expect(result.system).toBeUndefined();
    expect(result.messages).toHaveLength(1);
  });

  it("passes through stop and tools", () => {
    const result = decode(convertOpenAIRequestToOllama("llama3", encode({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      stop: ["END"],
      tools: [{ type: "function", function: { name: "search" } }],
    }), true));
    expect(result.stop).toEqual(["END"]);
    expect(result.tools).toBeDefined();
  });

  it("maps top_p to options.top_p", () => {
    const result = decode(convertOpenAIRequestToOllama("llama3", encode({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      top_p: 0.9,
    }), true));
    const options = result.options as Record<string, unknown>;
    expect(options.top_p).toBe(0.9);
  });
});