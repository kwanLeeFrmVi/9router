/**
 * Unit tests for ai-bridge handlers: handleChatCore.
 * Uses Bun's native test runner. Mocks globalThis.fetch.
 */

import { describe, it, expect } from "bun:test";
import { handleChatCore } from "../../ai-bridge/handlers/chatCore.ts";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("handleChatCore", () => {
  it("returns error for unknown provider", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      // Unknown provider falls through to default openai URL, then auth fails
      return Promise.resolve(new globalThis.Response("Unauthorized", { status: 401 }));
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await handleChatCore({
        body: { model: "unknown-model", messages: [{ role: "user", content: "hello" }] },
        modelInfo: { provider: "unknown_provider", model: "unknown-model" },
        credentials: {},
      });
      // Falls through to openai URL (default) → 401
      expect(result.success).toBe(false);
      expect(result.status ?? 0).toBeGreaterThanOrEqual(400);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("non-streaming: passes body to upstream and returns response", async () => {
    let capturedBody = "";
    const origFetch = globalThis.fetch;
    // Use "ollama" provider — not in STREAM_PROVIDERS, so stream:false is respected.
    // ollama defaults to OPENAI format, so source=target=OPENAI → no translation needed.
    globalThis.fetch = ((_url: URL | RequestInfo, init?: RequestInit) => {
      capturedBody = (init?.body as string) ?? "";
      // Return non-streaming JSON response
      return Promise.resolve(new globalThis.Response(JSON.stringify({
        id: "chatcmpl_123",
        object: "chat.completion",
        model: "llama3",
        choices: [{
          index: 0,
          message: { role: "assistant", content: "hello from ollama" },
          finish_reason: "stop",
        }],
        usage: { prompt_tokens: 5, completion_tokens: 4, total_tokens: 9 },
      }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }));
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await handleChatCore({
        body: { model: "llama3", messages: [{ role: "user", content: "hi" }], stream: false },
        modelInfo: { provider: "ollama", model: "llama3" },
        credentials: { apiKey: "test-key" },
      });

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      // Verify model was set in the body sent upstream
      expect(capturedBody).toContain("llama3");

      // Read the response body
      const responseText = await result.response!.text();
      const parsed = JSON.parse(responseText);
      expect(parsed.choices[0].message.content).toBe("hello from ollama");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("returns 502 on network failure", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      throw new Error("Connection refused");
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await handleChatCore({
        body: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
        modelInfo: { provider: "openai", model: "gpt-4o" },
        credentials: { apiKey: "test-key" },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(502);
      expect(result.error).toContain("Connection refused");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("handles upstream 401 error", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      return Promise.resolve(new globalThis.Response("Invalid API key", { status: 401 }));
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await handleChatCore({
        body: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
        modelInfo: { provider: "openai", model: "gpt-4o" },
        credentials: { apiKey: "bad-key" },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(401);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("handles upstream 429 rate limit", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      return Promise.resolve(new globalThis.Response("Rate limit exceeded", { status: 429 }));
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await handleChatCore({
        body: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
        modelInfo: { provider: "openai", model: "gpt-4o" },
        credentials: { apiKey: "test-key" },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(429);
      expect(result.error).toContain("Rate limited");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("handles upstream 500 server error", async () => {
    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      return Promise.resolve(new globalThis.Response("Internal server error", { status: 500 }));
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await handleChatCore({
        body: { model: "gpt-4o", messages: [{ role: "user", content: "hello" }] },
        modelInfo: { provider: "openai", model: "gpt-4o" },
        credentials: { apiKey: "test-key" },
      });

      expect(result.success).toBe(false);
      expect(result.status).toBe(500);
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("streaming: returns SSE response with text/event-stream content-type", async () => {
    const sseChunks = [
      'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"role":"assistant","content":""},"finish_reason":null}]}\n\n',
      'data: {"id":"chatcmpl_123","object":"chat.completion.chunk","model":"gpt-4o","choices":[{"index":0,"delta":{"content":"hi"},"finish_reason":null}]}\n\n',
      'data: [DONE]\n\n',
    ];

    const origFetch = globalThis.fetch;
    globalThis.fetch = (() => {
      const body = new ReadableStream({
        start(controller) {
          let i = 0;
          const enqueue = () => {
            if (i < sseChunks.length) {
              controller.enqueue(new TextEncoder().encode(sseChunks[i++]));
              setTimeout(enqueue, 10);
            } else {
              controller.close();
            }
          };
          enqueue();
        },
      });
      return Promise.resolve(new globalThis.Response(body, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }));
    }) as unknown as typeof globalThis.fetch;

    try {
      const result = await handleChatCore({
        body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true },
        modelInfo: { provider: "openai", model: "gpt-4o" },
        credentials: { apiKey: "test-key" },
      });

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.response!.headers.get("Content-Type")).toBe("text/event-stream");
    } finally {
      globalThis.fetch = origFetch;
    }
  });

  it("returns 502 when upstream body is empty (null body)", async () => {
    const origFetch = globalThis.fetch;
    // new Response(null) yields body === null, which handleStreamingResponse detects
    globalThis.fetch = (() =>
      Promise.resolve(new globalThis.Response(null as unknown as BodyInit, {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      }))
    ) as unknown as typeof globalThis.fetch;

    try {
      const result = await handleChatCore({
        body: { model: "gpt-4o", messages: [{ role: "user", content: "hi" }], stream: true },
        modelInfo: { provider: "openai", model: "gpt-4o" },
        credentials: { apiKey: "test-key" },
      });

      expect(result.success).toBe(true);
      expect(result.response).toBeDefined();
      expect(result.response!.status).toBe(502);
    } finally {
      globalThis.fetch = origFetch;
    }
  });
});
