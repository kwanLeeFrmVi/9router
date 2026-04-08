/**
 * Unit tests for ai-bridge/translator/util/index.ts
 * Covers: sanitizeClaudeToolID, toolNameMapFromRequest, mapToolName,
 * fixPartialJSON, isValidJSON, ensureToolCallIds
 */

import { describe, it, expect } from "bun:test";
import {
  sanitizeClaudeToolID,
  toolNameMapFromRequest,
  mapToolName,
  fixPartialJSON,
  isValidJSON,
  ensureToolCallIds,
} from "../../ai-bridge/translator/util/index.ts";

// ─── sanitizeClaudeToolID ─────────────────────────────────────────────────────

describe("sanitizeClaudeToolID", () => {
  it("returns a generated ID for empty string", () => {
    const id = sanitizeClaudeToolID("");
    expect(id).toMatch(/^tool_[a-z0-9]+$/);
  });

  it("replaces non-alphanumeric characters with underscores", () => {
    expect(sanitizeClaudeToolID("call_abc-123")).toBe("call_abc_123");
  });

  it("keeps alphanumeric IDs unchanged", () => {
    expect(sanitizeClaudeToolID("call_abc123")).toBe("call_abc123");
  });

  it("handles IDs with dots and dashes", () => {
    expect(sanitizeClaudeToolID("my.tool-v2")).toBe("my_tool_v2");
  });
});

// ─── toolNameMapFromRequest ────────────────────────────────────────────────────

describe("toolNameMapFromRequest", () => {
  it("extracts map from Uint8Array with _toolNameMap", () => {
    const raw = new TextEncoder().encode(JSON.stringify({
      _toolNameMap: { "get_weather": "getWeather", "search_web": "searchWeb" },
    }));
    const map = toolNameMapFromRequest(raw);
    expect(map.get("get_weather")).toBe("getWeather");
    expect(map.get("search_web")).toBe("searchWeb");
  });

  it("extracts map from string with _toolNameMap", () => {
    const json = JSON.stringify({ _toolNameMap: { foo: "bar" } });
    const map = toolNameMapFromRequest(json);
    expect(map.get("foo")).toBe("bar");
  });

  it("extracts map from object with _toolNameMap", () => {
    const map = toolNameMapFromRequest({ _toolNameMap: { a: "b" } });
    expect(map.get("a")).toBe("b");
  });

  it("returns empty map when no _toolNameMap field", () => {
    expect(toolNameMapFromRequest({ messages: [] }).size).toBe(0);
  });

  it("returns empty map on invalid JSON string", () => {
    expect(toolNameMapFromRequest("not json").size).toBe(0);
  });

  it("returns empty map on invalid Uint8Array", () => {
    expect(toolNameMapFromRequest(new Uint8Array([0xff, 0xfe])).size).toBe(0);
  });
});

// ─── mapToolName ───────────────────────────────────────────────────────────────

describe("mapToolName", () => {
  it("returns original name when map is null", () => {
    expect(mapToolName(null, "get_weather")).toBe("get_weather");
  });

  it("returns original name when map is empty", () => {
    expect(mapToolName(new Map(), "get_weather")).toBe("get_weather");
  });

  it("reverse-maps a translated name back to the original", () => {
    const map = new Map([["get_weather", "getWeather"]]);
    // "getWeather" was the translated name → should reverse to "get_weather"
    expect(mapToolName(map, "getWeather")).toBe("get_weather");
  });

  it("returns the name unchanged if not found in the map", () => {
    const map = new Map([["get_weather", "getWeather"]]);
    expect(mapToolName(map, "unknown_fn")).toBe("unknown_fn");
  });
});

// ─── fixPartialJSON ───────────────────────────────────────────────────────────

describe("fixPartialJSON", () => {
  // fixPartialJSON only adds closing braces/brackets for unmatched openers.
  // It does NOT fix missing values (e.g. {"key":} is still invalid JSON).
  // It's designed for streaming tool call argument accumulation.

  it("adds closing brace for unclosed object", () => {
    const result = fixPartialJSON('{"key": 1');
    expect(result).toBe('{"key": 1}');
    expect(isValidJSON(result)).toBe(true);
  });

  it("adds closing bracket for unclosed array", () => {
    const result = fixPartialJSON("[1, 2");
    expect(result).toBe("[1, 2]");
    expect(isValidJSON(result)).toBe(true);
  });

  it("closes braces and brackets (braces first, then brackets)", () => {
    // Note: fixPartialJSON closes braces first, then brackets.
    // For {"a": [1 → {"a": [1}] — this is invalid JSON because ] comes before }.
    // The function is designed for simple tool call argument accumulation, not complex nesting.
    const result = fixPartialJSON('{"a": [1');
    expect(result).toBe('{"a": [1}]');
    // This is a known limitation — not valid JSON for nested structures
  });

  it("leaves valid JSON unchanged", () => {
    const valid = '{"key": "value"}';
    expect(fixPartialJSON(valid)).toBe(valid);
  });

  it("handles empty string", () => {
    expect(fixPartialJSON("")).toBe("");
  });

  it("handles whitespace-only string", () => {
    expect(fixPartialJSON("   ")).toBe("");
  });

  it("completes partial JSON with unclosed string value", () => {
    // '{"name": "test' → adds closing quote + brace
    const result = fixPartialJSON('{"name": "test');
    expect(isValidJSON(result)).toBe(true);
  });

  it("closes multiple nested braces", () => {
    const result = fixPartialJSON('{"a": {"b": 1');
    expect(result).toBe('{"a": {"b": 1}}');
    expect(isValidJSON(result)).toBe(true);
  });
});

// ─── isValidJSON ──────────────────────────────────────────────────────────────

describe("isValidJSON", () => {
  it("returns true for valid JSON object", () => {
    expect(isValidJSON('{"key": "value"}')).toBe(true);
  });

  it("returns true for valid JSON array", () => {
    expect(isValidJSON("[1, 2, 3]")).toBe(true);
  });

  it("returns true for valid JSON primitive", () => {
    expect(isValidJSON("42")).toBe(true);
    expect(isValidJSON('"hello"')).toBe(true);
    expect(isValidJSON("true")).toBe(true);
    expect(isValidJSON("null")).toBe(true);
  });

  it("returns false for invalid JSON", () => {
    expect(isValidJSON("{invalid}")).toBe(false);
    expect(isValidJSON("not json")).toBe(false);
  });

  it("returns false for incomplete JSON", () => {
    expect(isValidJSON('{"key":')).toBe(false);
  });
});

// ─── ensureToolCallIds ────────────────────────────────────────────────────────

describe("ensureToolCallIds", () => {
  it("adds id to tool_calls without id", () => {
    const body = {
      messages: [{
        role: "assistant",
        content: [{
          type: "tool_calls",
          tool_calls: [{ function: { name: "fn1", arguments: "{}" } }],
        }],
      }],
    };
    ensureToolCallIds(body);
    const calls = (body.messages[0].content as Array<Record<string, unknown>>)[0].tool_calls as Array<Record<string, unknown>>;
    expect(calls[0].id).toBeDefined();
    expect(calls[0].id).toMatch(/^call_/);
  });

  it("does not overwrite existing tool call ids", () => {
    const body = {
      messages: [{
        role: "assistant",
        content: [{
          type: "tool_calls",
          tool_calls: [{ id: "existing_id", function: { name: "fn1", arguments: "{}" } }],
        }],
      }],
    };
    ensureToolCallIds(body);
    const calls = (body.messages[0].content as Array<Record<string, unknown>>)[0].tool_calls as Array<Record<string, unknown>>;
    expect(calls[0].id).toBe("existing_id");
  });

  it("handles messages without content array", () => {
    const body = { messages: [{ role: "user", content: "hello" }] };
    expect(() => ensureToolCallIds(body)).not.toThrow();
  });

  it("handles messages without messages field", () => {
    const body = {};
    expect(() => ensureToolCallIds(body)).not.toThrow();
  });
});