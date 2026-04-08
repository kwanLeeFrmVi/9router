/**
 * Multi-chunk streaming state-machine tests for ai-bridge response translators.
 * Tests state accumulation across multiple SSE chunks: message_start → content → message_stop.
 * Key: streaming functions mutate state objects in-place, so we create and pass the same reference.
 */

import { describe, it, expect } from "bun:test";
import { convertClaudeResponseToOpenAI, type OpenAIStreamingState } from "../../ai-bridge/translator/openai/claude/response.ts";
import { convertOpenAIResponseToClaude, type StreamingState } from "../../ai-bridge/translator/claude/openai/response.ts";
import { convertGeminiResponseToOpenAI, type GeminiStreamingState } from "../../ai-bridge/translator/gemini/openai/response.ts";
import { convertOllamaResponseToClaude, type OllamaStreamingState } from "../../ai-bridge/translator/ollama/claude/response.ts";
import { convertOpenAIResponseToGemini, type OpenAIGeminiState } from "../../ai-bridge/translator/openai/gemini/response.ts";

const enc = new TextEncoder();
const dec = new TextDecoder();
const NO_RAW = new Uint8Array(0);

function decodeAll(chunks: Uint8Array[]): string {
  return chunks.map(c => dec.decode(c)).join("");
}

// Helper to create fresh state objects
function newOpenAIState(): OpenAIStreamingState {
  return {
    messageId: "", model: "", finishReason: "", finishReasonSent: false, messageStopSent: false,
    textIndex: -1, textStarted: false, thinkingIndex: -1, thinkingStarted: false,
    contentBlocksStopped: false, toolCallIndex: -1, toolCallsStarted: false,
    toolCallBlockIndex: -1, currentToolIndex: -1, contentAccumulator: "",
    toolArgumentsAccumulator: "", currentToolName: "", currentToolId: "",
  };
}

function newStreamingState(): StreamingState {
  return {
    messageId: "", model: "", createdAt: 0, sawToolCall: false, finishReason: "",
    toolNameMap: new Map(), textBlockIndex: -1, thinkingBlockIndex: -1, nextBlockIndex: 0,
    textBlockStarted: false, thinkingBlockStarted: false, contentBlocksStopped: false,
    toolCalls: new Map(), toolBlockIndexes: new Map(), toolBlockStopped: new Map(),
    messageStarted: false, messageDeltaSent: false, messageStopSent: false, contentAccumulator: "",
  };
}

function newGeminiState(): GeminiStreamingState {
  return {
    messageId: "", model: "", textBlockStarted: false, textBlockIndex: -1,
    nextBlockIndex: 0, messageStarted: false, messageStopSent: false, contentAccumulator: "",
  };
}

function newOllamaState(): OllamaStreamingState {
  return {
    messageId: "", model: "", textBlockStarted: false, textBlockIndex: -1,
    nextBlockIndex: 0, messageStarted: false, messageStopSent: false, contentAccumulator: "",
  };
}

function newOpenAIGeminiState(): OpenAIGeminiState {
  return {
    messageId: "", model: "", roleSet: false, contentAccumulator: "", messageStopSent: false,
  };
}

// ─── Claude → OpenAI: multi-chunk streaming ────────────────────────────────────

describe("Claude → OpenAI streaming (multi-chunk)", () => {
  it("handles full lifecycle: message_start → text_delta → message_delta → message_stop", () => {
    const state = newOpenAIState();

    // Chunk 1: message_start
    const chunk1 = enc.encode(`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1","type":"message","role":"assistant","model":"claude-sonnet-4","content":[],"stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n`);
    const r1 = convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk1, state);
    const t1 = decodeAll(r1);
    expect(t1).toContain("chat.completion.chunk");
    expect(t1).toContain('"role":"assistant"');

    // Chunk 2: content_block_start (text)
    const chunk2 = enc.encode(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}\n\n`);
    const r2 = convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk2, state);
    // content_block_start for text is a no-op in OpenAI (just sets state)

    // Chunk 3: content_block_delta (text)
    const chunk3 = enc.encode(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hello"}}\n\n`);
    const r3 = convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk3, state);
    const t3 = decodeAll(r3);
    expect(t3).toContain('"content":"Hello"');

    // Chunk 4: content_block_stop
    const chunk4 = enc.encode(`event: content_block_stop\ndata: {"type":"content_block_stop","index":0}\n\n`);
    convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk4, state);

    // Chunk 5: message_delta with stop_reason
    const chunk5 = enc.encode(`event: message_delta\ndata: {"type":"message_delta","delta":{"stop_reason":"end_turn","stop_sequence":null},"usage":{"output_tokens":5}}\n\n`);
    const r5 = convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk5, state);
    const t5 = decodeAll(r5);
    expect(t5).toContain('"finish_reason":"stop"');

    // Chunk 6: message_stop
    const chunk6 = enc.encode(`event: message_stop\ndata: {"type":"message_stop"}\n\n`);
    const r6 = convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, chunk6, state);
    const t6 = decodeAll(r6);
    expect(t6).toContain("[DONE]");
  });

  it("handles thinking blocks in multi-chunk stream", () => {
    const state = newOpenAIState();

    // message_start
    const c1 = enc.encode(`event: message_start\ndata: {"type":"message_start","message":{"id":"msg_2","type":"message","role":"assistant","model":"claude-sonnet-4","content":[],"stop_reason":null,"usage":{"input_tokens":10,"output_tokens":0}}}\n\n`);
    convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, c1, state);

    // thinking block start
    const c2 = enc.encode(`event: content_block_start\ndata: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}\n\n`);
    const r2 = convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, c2, state);
    // Thinking blocks are skipped in OpenAI format (no equivalent)
    // The converter sets state but doesn't emit anything

    // thinking delta — skipped
    const c3 = enc.encode(`event: content_block_delta\ndata: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"Let me think..."}}\n\n`);
    const r3 = convertClaudeResponseToOpenAI(null, "claude-sonnet-4", NO_RAW, NO_RAW, c3, state);
    // thinking_delta is skipped in OpenAI format
  });
});

// ─── OpenAI → Claude: multi-chunk streaming ───────────────────────────────────

describe("OpenAI → Claude streaming (multi-chunk)", () => {
  it("handles full lifecycle: role → content → finish", () => {
    const state = newStreamingState();

    // Chunk 1: role
    const c1 = enc.encode(`data: {"id":"chatcmpl_1","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`);
    const r1 = convertOpenAIResponseToClaude(null, "gpt-4o", NO_RAW, NO_RAW, c1, state);
    const t1 = decodeAll(r1);
    expect(t1).toContain("event: message_start");

    // Chunk 2: content
    const c2 = enc.encode(`data: {"id":"chatcmpl_1","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"Hello"},"finish_reason":null}]}\n\n`);
    const r2 = convertOpenAIResponseToClaude(null, "gpt-4o", NO_RAW, NO_RAW, c2, state);
    const t2 = decodeAll(r2);
    expect(t2).toContain("event: content_block_start");
    expect(t2).toContain("event: content_block_delta");
    expect(t2).toContain("Hello");

    // Chunk 3: more content
    const c3 = enc.encode(`data: {"id":"chatcmpl_1","model":"gpt-4o","choices":[{"index":0,"delta":{"content":" world"},"finish_reason":null}]}\n\n`);
    const r3 = convertOpenAIResponseToClaude(null, "gpt-4o", NO_RAW, NO_RAW, c3, state);
    const t3 = decodeAll(r3);
    expect(t3).toContain("event: content_block_delta");
    expect(t3).toContain("world");

    // Chunk 4: finish
    const c4 = enc.encode(`data: {"id":"chatcmpl_1","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`);
    const r4 = convertOpenAIResponseToClaude(null, "gpt-4o", NO_RAW, NO_RAW, c4, state);
    const t4 = decodeAll(r4);
    expect(t4).toContain("event: content_block_stop");

    // Chunk 5: [DONE] — triggers message_delta and message_stop
    const c5 = enc.encode("data: [DONE]\n\n");
    const r5 = convertOpenAIResponseToClaude(null, "gpt-4o", NO_RAW, NO_RAW, c5, state);
    const t5 = decodeAll(r5);
    expect(t5).toContain("event: message_delta");
    expect(t5).toContain("event: message_stop");
  });

  it("does not emit duplicate message_start across chunks", () => {
    const state = newStreamingState();
    const c1 = enc.encode(`data: {"id":"c1","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n`);
    convertOpenAIResponseToClaude(null, "gpt-4o", NO_RAW, NO_RAW, c1, state);

    const c2 = enc.encode(`data: {"id":"c1","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n`);
    const r2 = convertOpenAIResponseToClaude(null, "gpt-4o", NO_RAW, NO_RAW, c2, state);
    const t2 = decodeAll(r2);
    // Should NOT contain a second message_start
    expect(t2).not.toContain("event: message_start");
  });
});

// ─── Gemini → OpenAI: multi-chunk streaming ────────────────────────────────────

describe("Gemini → OpenAI streaming (multi-chunk)", () => {
  it("handles full lifecycle: text chunks → finish", () => {
    const state = newGeminiState();

    // Chunk 1: text
    const c1 = enc.encode(`data: {"candidates":[{"content":{"parts":[{"text":"Hello"}],"role":"model"},"finishReason":null}]}\n\n`);
    const r1 = convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, c1, state);
    const t1 = decodeAll(r1);
    expect(t1).toContain('"content":"Hello"');

    // Chunk 2: more text
    const c2 = enc.encode(`data: {"candidates":[{"content":{"parts":[{"text":" world"}],"role":"model"},"finishReason":null}]}\n\n`);
    const r2 = convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, c2, state);
    const t2 = decodeAll(r2);
    expect(t2).toContain('"content":" world"');

    // Chunk 3: finish with STOP — Gemini→OpenAI handles STOP via [DONE] sentinel
    const c3 = enc.encode(`data: {"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"STOP"}]}\n\n`);
    const r3 = convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, c3, state);
    // STOP finishReason is not handled inline (only non-STOP/MAX_TOKENS are); it's handled via [DONE]

    // Chunk 4: [DONE] sentinel emits final finish_reason
    const c4 = enc.encode("data: [DONE]\n\n");
    const r4 = convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, c4, state);
    const t4 = decodeAll(r4);
    expect(t4).toContain('"finish_reason":"stop"');
  });

  it("maps SAFETY finish reason to content_filter (inline)", () => {
    const state = newGeminiState();
    const c1 = enc.encode(`data: {"candidates":[{"content":{"parts":[{"text":"text"}],"role":"model"},"finishReason":null}]}\n\n`);
    convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, c1, state);

    // finishReason lives inside candidates[0] in Gemini streaming SSE
    const c2 = enc.encode(`data: {"candidates":[{"content":{"parts":[],"role":"model"},"finishReason":"SAFETY"}]}\n\n`);
    const r2 = convertGeminiResponseToOpenAI(null, "gemini-2.0-flash", NO_RAW, NO_RAW, c2, state);
    const t2 = decodeAll(r2);
    expect(t2).toContain('"finish_reason":"content_filter"');
  });
});

// ─── Ollama → Claude: multi-chunk streaming ────────────────────────────────────

describe("Ollama → Claude streaming (multi-chunk)", () => {
  it("handles full lifecycle: message_start → content → done", () => {
    const state = newOllamaState();

    // Chunk 1: first text
    const c1 = enc.encode(`data: {"model":"llama3","message":{"role":"assistant","content":"Hel"}}\n\n`);
    const r1 = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, c1, state);
    const t1 = decodeAll(r1);
    expect(t1).toContain("event: message_start");
    expect(t1).toContain("event: content_block_start");
    expect(t1).toContain("Hel");

    // Chunk 2: more text
    const c2 = enc.encode(`data: {"model":"llama3","message":{"role":"assistant","content":"lo"}}\n\n`);
    const r2 = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, c2, state);
    const t2 = decodeAll(r2);
    // Should NOT contain a second message_start
    expect(t2).not.toContain("event: message_start");
    expect(t2).toContain("event: content_block_delta");
    expect(t2).toContain("lo");

    // Chunk 3: done
    const c3 = enc.encode(`data: {"model":"llama3","done":true,"done_reason":"stop"}\n\n`);
    const r3 = convertOllamaResponseToClaude(null, "llama3", NO_RAW, NO_RAW, c3, state);
    const t3 = decodeAll(r3);
    expect(t3).toContain("event: content_block_stop");
    expect(t3).toContain("event: message_delta");
    expect(t3).toContain("event: message_stop");
  });
});

// ─── OpenAI → Gemini: multi-chunk streaming ────────────────────────────────────

describe("OpenAI → Gemini streaming (multi-chunk)", () => {
  it("handles full lifecycle: content → finish", () => {
    const state = newOpenAIGeminiState();

    // Chunk 1: content with role
    const c1 = enc.encode(`data: {"id":"c1","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":"Hi"},"finish_reason":null}]}\n\n`);
    const r1 = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, c1, state);
    const t1 = decodeAll(r1);
    expect(t1).toContain('"text":"Hi"');

    // Chunk 2: more content
    const c2 = enc.encode(`data: {"id":"c1","model":"gpt-4o","choices":[{"index":0,"delta":{"content":" there"},"finish_reason":null}]}\n\n`);
    const r2 = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, c2, state);
    const t2 = decodeAll(r2);
    expect(t2).toContain('"text":" there"');

    // Chunk 3: finish
    const c3 = enc.encode(`data: {"id":"c1","model":"gpt-4o","choices":[{"index":0,"delta":{},"finish_reason":"stop"}]}\n\n`);
    const r3 = convertOpenAIResponseToGemini(null, "gpt-4o", NO_RAW, NO_RAW, c3, state);
    const t3 = decodeAll(r3);
    expect(t3).toContain('"finishReason":"STOP"');
    expect(t3).toContain("[DONE]");
  });
});