/**
 * Unit tests for ai-bridge/handlers/provider.ts
 * Tests: detectFormat, getTargetFormat, buildUpstreamUrl, buildUpstreamHeaders
 */

import { describe, it, expect } from "bun:test";
import { detectFormat, getTargetFormat, buildUpstreamUrl, buildUpstreamHeaders } from "../../ai-bridge/handlers/provider.ts";
import { FORMATS } from "../../ai-bridge/translator/formats.ts";

// ─── detectFormat ──────────────────────────────────────────────────────────────

describe("detectFormat", () => {
  it("returns CLAUDE for body with system + array messages with content", () => {
    const result = detectFormat({
      model: "claude-sonnet-4",
      system: "You are helpful",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      anthropic_version: "2023-06-01",
    });
    expect(result).toBe(FORMATS.CLAUDE);
  });

  it("returns CLAUDE for body with anthropic_version and text content", () => {
    const result = detectFormat({
      model: "claude-sonnet-4",
      system: "system prompt",
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
      anthropic_version: "2023-06-01",
    });
    expect(result).toBe(FORMATS.CLAUDE);
  });

  it("returns CLAUDE for body with tool_use content", () => {
    const result = detectFormat({
      messages: [{
        role: "assistant",
        content: [{ type: "tool_use", id: "tool_1", name: "foo", input: {} }],
      }],
    });
    expect(result).toBe(FORMATS.CLAUDE);
  });

  it("returns CLAUDE for body with tool_result content", () => {
    const result = detectFormat({
      messages: [{
        role: "user",
        content: [{ type: "tool_result", tool_use_id: "tool_1", content: "result" }],
      }],
    });
    expect(result).toBe(FORMATS.CLAUDE);
  });

  it("returns CLAUDE for body with Claude image (source.type=base64)", () => {
    const result = detectFormat({
      messages: [{
        role: "user",
        content: [{ type: "image", source: { type: "base64", media_type: "image/png", data: "abc" } }],
      }],
    });
    expect(result).toBe(FORMATS.CLAUDE);
  });

  it("returns GEMINI for body with contents array", () => {
    const result = detectFormat({
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
    });
    expect(result).toBe(FORMATS.GEMINI);
  });

  it("returns OPENAI_RESPONSES for body with input array", () => {
    const result = detectFormat({
      input: [{ type: "message", role: "user", content: "hi" }],
    });
    expect(result).toBe(FORMATS.OPENAI_RESPONSES);
  });

  it("returns OPENAI for body with stream_options", () => {
    const result = detectFormat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      stream_options: { include_usage: true },
    });
    expect(result).toBe(FORMATS.OPENAI);
  });

  it("returns OPENAI for body with response_format", () => {
    const result = detectFormat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      response_format: { type: "json_object" },
    });
    expect(result).toBe(FORMATS.OPENAI);
  });

  it("returns OPENAI for body with logprobs", () => {
    const result = detectFormat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      logprobs: true,
    });
    expect(result).toBe(FORMATS.OPENAI);
  });

  it("returns OPENAI for body with n field", () => {
    const result = detectFormat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      n: 3,
    });
    expect(result).toBe(FORMATS.OPENAI);
  });

  it("defaults to OPENAI for simple chat body", () => {
    const result = detectFormat({
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
    });
    expect(result).toBe(FORMATS.OPENAI);
  });

  it("defaults to OPENAI for null body", () => {
    const result = detectFormat(null);
    expect(result).toBe(FORMATS.OPENAI);
  });

  it("defaults to OPENAI for empty body", () => {
    const result = detectFormat({});
    expect(result).toBe(FORMATS.OPENAI);
  });
});

// ─── getTargetFormat ───────────────────────────────────────────────────────────

describe("getTargetFormat", () => {
  it("returns CLAUDE for claude provider", () => {
    expect(getTargetFormat("claude")).toBe(FORMATS.CLAUDE);
  });

  it("returns GEMINI for gemini provider", () => {
    expect(getTargetFormat("gemini")).toBe(FORMATS.GEMINI);
  });

  it("returns GEMINI for gemini-cli provider", () => {
    expect(getTargetFormat("gemini-cli")).toBe(FORMATS.GEMINI);
  });

  it("returns OLLAMA for ollama provider", () => {
    expect(getTargetFormat("ollama")).toBe(FORMATS.OLLAMA);
  });

  it("returns ANTIGRAVITY for antigravity provider", () => {
    expect(getTargetFormat("antigravity")).toBe(FORMATS.ANTIGRAVITY);
  });

  it("defaults to OPENAI for openai provider", () => {
    expect(getTargetFormat("openai")).toBe(FORMATS.OPENAI);
  });

  it("defaults to OPENAI for unknown provider", () => {
    expect(getTargetFormat("unknown_provider")).toBe(FORMATS.OPENAI);
  });
});

// ─── buildUpstreamUrl ─────────────────────────────────────────────────────────

describe("buildUpstreamUrl", () => {
  it("returns OpenAI URL for openai provider", () => {
    const url = buildUpstreamUrl("openai", "gpt-4o", true, { apiKey: "sk-test" });
    expect(url).toContain("api.openai.com");
    expect(url).toContain("chat/completions");
  });

  it("returns OpenAI URL for openrouter provider", () => {
    const url = buildUpstreamUrl("openrouter", "gpt-4o", true, { apiKey: "sk-test" });
    expect(url).toContain("api.openai.com");
  });

  it("returns OpenAI URL for anthropic provider", () => {
    const url = buildUpstreamUrl("anthropic", "claude-3", true, { apiKey: "sk-test" });
    expect(url).toContain("api.openai.com");
  });

  it("returns Gemini streamGenerateContent URL for gemini provider with streaming", () => {
    const url = buildUpstreamUrl("gemini", "gemini-2.0-flash", true, { apiKey: "test-key" });
    expect(url).toContain("generativelanguage.googleapis.com");
    expect(url).toContain("streamGenerateContent");
    expect(url).toContain("key=test-key");
  });

  it("returns Gemini generateContent URL for gemini provider without streaming", () => {
    const url = buildUpstreamUrl("gemini", "gemini-2.0-flash", false, { apiKey: "test-key" });
    expect(url).toContain("generateContent");
    expect(url).not.toContain("streamGenerateContent");
  });

  it("returns null for gemini provider without apiKey", () => {
    const url = buildUpstreamUrl("gemini", "gemini-2.0-flash", true, {});
    expect(url).toBeNull();
  });

  it("returns Gemini URL for claude provider (uses Gemini API)", () => {
    const url = buildUpstreamUrl("claude", "claude-sonnet-4", true, { apiKey: "test" });
    expect(url).toContain("generativelanguage.googleapis.com");
  });

  it("returns Gemini stream URL for gemini-cli with accessToken", () => {
    const url = buildUpstreamUrl("gemini-cli", "gemini-2.0-flash", true, { accessToken: "token123" });
    expect(url).toContain("streamGenerateContent");
  });

  it("returns null for gemini-cli without accessToken", () => {
    const url = buildUpstreamUrl("gemini-cli", "gemini-2.0-flash", true, {});
    expect(url).toBeNull();
  });

  it("returns Ollama URL for ollama provider", () => {
    const url = buildUpstreamUrl("ollama", "llama3", true, {});
    expect(url).toContain("localhost:11434");
    expect(url).toContain("api/chat");
  });

  it("returns custom Ollama URL from providerSpecificData", () => {
    const url = buildUpstreamUrl("ollama", "llama3", true, {
      providerSpecificData: { baseUrl: "http://my-ollama:8080" },
    });
    expect(url).toContain("my-ollama:8080");
  });

  it("returns kimi URL for kilocode provider", () => {
    const url = buildUpstreamUrl("kilocode", "model", true, { apiKey: "test" });
    expect(url).toContain("kimi.com");
  });

  it("returns kimi URL for kimi-coding provider", () => {
    const url = buildUpstreamUrl("kimi-coding", "model", true, { apiKey: "test" });
    expect(url).toContain("kimi.com");
  });

  it("defaults to OpenAI URL for unknown provider", () => {
    const url = buildUpstreamUrl("unknown", "model", true, { apiKey: "test" });
    expect(url).toContain("api.openai.com");
  });
});

// ─── buildUpstreamHeaders ─────────────────────────────────────────────────────

describe("buildUpstreamHeaders", () => {
  it("sets Bearer Authorization for openai provider with apiKey", () => {
    const headers = buildUpstreamHeaders("openai", { apiKey: "sk-test" });
    expect(headers["Authorization"]).toBe("Bearer sk-test");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  it("sets Bearer Authorization for openrouter with accessToken", () => {
    const headers = buildUpstreamHeaders("openrouter", { accessToken: "tok123" });
    expect(headers["Authorization"]).toBe("Bearer tok123");
  });

  it("sets x-api-key and Anthropic-Version for claude provider with apiKey", () => {
    const headers = buildUpstreamHeaders("claude", { apiKey: "sk-ant-test" });
    expect(headers["x-api-key"]).toBe("sk-ant-test");
    expect(headers["Anthropic-Version"]).toBe("2023-06-01");
  });

  it("sets Bearer Authorization for claude provider with accessToken", () => {
    const headers = buildUpstreamHeaders("claude", { accessToken: "tok456" });
    expect(headers["Authorization"]).toBe("Bearer tok456");
    expect(headers["Anthropic-Version"]).toBe("2023-06-01");
  });

  it("does not set Authorization header for gemini provider (key in URL)", () => {
    const headers = buildUpstreamHeaders("gemini", { apiKey: "test-key" });
    expect(headers["Authorization"]).toBeUndefined();
  });

  it("sets Bearer Authorization for gemini-cli with accessToken", () => {
    const headers = buildUpstreamHeaders("gemini-cli", { accessToken: "tok789" });
    expect(headers["Authorization"]).toBe("Bearer tok789");
  });

  it("sets Bearer Authorization for antigravity with accessToken", () => {
    const headers = buildUpstreamHeaders("antigravity", { accessToken: "tok" });
    expect(headers["Authorization"]).toBe("Bearer tok");
  });

  it("defaults to Bearer Authorization for unknown provider", () => {
    const headers = buildUpstreamHeaders("custom-provider", { apiKey: "key" });
    expect(headers["Authorization"]).toBe("Bearer key");
  });

  it("always sets Content-Type to application/json", () => {
    const providers = ["openai", "claude", "gemini", "ollama", "unknown"];
    for (const p of providers) {
      const headers = buildUpstreamHeaders(p, {});
      expect(headers["Content-Type"]).toBe("application/json");
    }
  });
});