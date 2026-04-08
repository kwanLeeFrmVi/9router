/**
 * Unit tests for ai-bridge SSE utilities.
 * Uses Bun's native test runner.
 */

import {
  buildSSEEvent,
  buildSSEData,
  appendSSEEventBytes,
  appendSSEDataBytes,
  formatTokenDataEvent,
} from "../../ai-bridge/translator/common/sse.ts";

// ─── buildSSEEvent ───────────────────────────────────────────────────────────

describe("buildSSEEvent", () => {
  it("produces event: + data: lines with double-newline terminator", () => {
    const result = buildSSEEvent("message_start", { id: "msg_1" });
    expect(result).toContain("event: message_start\n");
    expect(result).toContain("data: {\"id\":\"msg_1\"}");
    expect(result.endsWith("\n\n")).toBe(true);
    expect(result).not.toContain("event: message_start\n\n");
  });

  it("JSON-stringifies object payloads", () => {
    const result = buildSSEEvent("content_block_delta", { type: "content_block_delta", delta: { text: "hi" } });
    expect(result).toContain('"type":"content_block_delta"');
    expect(result).toContain('"text":"hi"');
  });

  it("passes through string payloads as-is", () => {
    const result = buildSSEEvent("error", "Something went wrong");
    expect(result).toContain("data: Something went wrong");
  });

  it("respects trailingNewlines parameter", () => {
    const two = buildSSEEvent("ping", { data: 1 }, 2);
    const three = buildSSEEvent("ping", { data: 1 }, 3);
    expect(two.endsWith("\n\n")).toBe(true);
    expect(two.endsWith("\n\n\n")).toBe(false);
    expect(three.endsWith("\n\n\n")).toBe(true);
  });
});

// ─── buildSSEData ────────────────────────────────────────────────────────────

describe("buildSSEData", () => {
  it("produces data-only lines (no event: prefix)", () => {
    const result = buildSSEData({ content: "hello" });
    expect(result).not.toContain("event:");
    expect(result).toContain("data: {\"content\":\"hello\"}");
    expect(result.endsWith("\n\n")).toBe(true);
  });

  it("JSON-stringifies object payloads", () => {
    const result = buildSSEData({ index: 0, content: ["a"] });
    expect(result).toContain('"index":0');
    expect(result).toContain('"content":["a"]');
  });

  it("passes through string payloads", () => {
    const result = buildSSEData("raw string data");
    expect(result).toContain("data: raw string data");
  });
});

// ─── appendSSEEventBytes ───────────────────────────────────────────────────────

describe("appendSSEEventBytes", () => {
  it("appends SSE event to empty Uint8Array", () => {
    const result = appendSSEEventBytes(new Uint8Array(0), "ping", { x: 1 });
    const text = new TextDecoder().decode(result);
    expect(text).toContain("event: ping\n");
    expect(text).toContain('"x":1');
  });

  it("appends SSE event to existing bytes (does not mutate input)", () => {
    const existing = new TextEncoder().encode("event: first\ndata: one\n\n");
    const result = appendSSEEventBytes(existing, "second", { y: 2 });
    const text = new TextDecoder().decode(result);
    expect(text).toContain("event: first");
    expect(text).toContain("event: second");
    expect(text).toContain('"y":2');
  });

  it("returns new Uint8Array, does not mutate input", () => {
    const existing = new TextEncoder().encode("event: first\ndata: one\n\n");
    const result = appendSSEEventBytes(existing, "second", { y: 2 });
    expect(result).not.toBe(existing);
    const existingText = new TextDecoder().decode(existing);
    expect(existingText).not.toContain("second");
  });
});

// ─── appendSSEDataBytes ─────────────────────────────────────────────────────

describe("appendSSEDataBytes", () => {
  it("appends data-only bytes to empty array", () => {
    const result = appendSSEDataBytes(new Uint8Array(0), { z: 3 });
    const text = new TextDecoder().decode(result);
    expect(text).not.toContain("event:");
    expect(text).toContain('"z":3');
  });

  it("appends data-only to existing content", () => {
    const existing = new TextEncoder().encode("data: one\n\n");
    const result = appendSSEDataBytes(existing, "two");
    const text = new TextDecoder().decode(result);
    expect(text).toContain("data: one");
    expect(text).toContain("data: two");
  });
});

// ─── formatTokenDataEvent ────────────────────────────────────────────────────

describe("formatTokenDataEvent", () => {
  it("produces message_delta event with token counts", () => {
    const result = formatTokenDataEvent(100, 50, 20);
    expect(result).toContain("event: message_delta\n");
    expect(result).toContain('"input_tokens":100');
    expect(result).toContain('"output_tokens":50');
    expect(result).toContain('"cache_read_input_tokens":20');
  });

  it("omits cache tokens when zero", () => {
    const result = formatTokenDataEvent(100, 50, 0);
    expect(result).not.toContain("cache_read_input_tokens");
    expect(result).toContain('"input_tokens":100');
    expect(result).toContain('"output_tokens":50');
  });
});
