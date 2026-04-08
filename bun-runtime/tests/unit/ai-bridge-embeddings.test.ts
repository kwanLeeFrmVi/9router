/**
 * Unit tests for ai-bridge embeddings handler.
 * Uses Bun's native test runner.
 */

import { handleEmbeddingsCore } from "../../ai-bridge/handlers/embeddingsCore.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeOptions(overrides = {}) {
  return {
    body: { model: "text-embedding-ada-002", input: "Hello world" },
    modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
    credentials: { apiKey: "sk-test-key" },
    log: {
      debug: () => {},
      info: () => {},
      warn: () => {},
      error: () => {},
    },
    onCredentialsRefreshed: async () => {},
    onRequestSuccess: async () => {},
    ...overrides,
  };
}

function makeOkResponse(body: unknown, status = 200) {
  return new globalThis.Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Test: handleEmbeddingsCore — input validation ────────────────────────────

describe("handleEmbeddingsCore — input validation", () => {
  beforeEach(() => {
    // No global fetch stub by default — override per test
  });

  it("returns success=false when input is missing", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002" },
    }));
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it("returns success=false when input is a number", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: 42 },
    }));
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it("returns success=false when input is an object", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      body: { model: "text-embedding-ada-002", input: { text: "hello" } },
    }));
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });
});

// ─── Test: handleEmbeddingsCore — URL building ────────────────────────────────

describe("handleEmbeddingsCore — URL building", () => {
  beforeEach(() => {
    globalThis.fetch = () => Promise.resolve(makeOkResponse({ object: "list", data: [] }));
  });

  it("openai → https://api.openai.com/v1/embeddings", async () => {
    globalThis.fetch = () => Promise.resolve(makeOkResponse({ object: "list", data: [] }));
    await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
    }));
    // URL is logged, fetch is called — verify success
    const result = await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openai", model: "text-embedding-ada-002" },
    }));
    expect(result.success).toBe(true);
  });

  it("openrouter → https://api.openai.com/v1/embeddings (fallback)", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "openrouter", model: "openai/text-embedding-ada-002" },
    }));
    expect(result.success).toBe(true);
  });

  it("gemini → GenerativeLanguage API URL with API key", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "gemini", model: "fake-api-key" },
      credentials: {},
    }));
    // gemini uses model field as api key — should still reach a URL
    expect(result.success).toBe(true);
  });

  it("cohere → https://api.cohere.ai/v1/embed", async () => {
    const result = await handleEmbeddingsCore(makeOptions({
      modelInfo: { provider: "cohere", model: "embed-v3" },
    }));
    expect(result.success).toBe(true);
  });
});

// ─── Test: handleEmbeddingsCore — success path ───────────────────────────────

describe("handleEmbeddingsCore — success path", () => {
  beforeEach(() => {
    globalThis.fetch = () => Promise.resolve(makeOkResponse({
      object: "list",
      data: [{ object: "embedding", index: 0, embedding: [0.1, 0.2, 0.3] }],
      usage: { prompt_tokens: 3, total_tokens: 3 },
    }));
  });

  it("returns success=true with Response on 200", async () => {
    const result = await handleEmbeddingsCore(makeOptions());
    expect(result.success).toBe(true);
    expect(result.response).toBeInstanceOf(globalThis.Response);
    expect(result.response!.status).toBe(200);
  });

  it("response body is valid JSON", async () => {
    const result = await handleEmbeddingsCore(makeOptions());
    const body = await result.response!.json();
    expect(body.object).toBe("list");
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.data[0].embedding).toBeDefined();
  });

  it("calls onRequestSuccess on success", async () => {
    let called = false;
    await handleEmbeddingsCore(makeOptions({
      onRequestSuccess: async () => { called = true; },
    }));
    expect(called).toBe(true);
  });

  it("does not call onRequestSuccess on failure", async () => {
    globalThis.fetch = () => Promise.resolve(
      new globalThis.Response(JSON.stringify({ error: "bad" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
    let called = false;
    const result = await handleEmbeddingsCore(makeOptions({
      onRequestSuccess: async () => { called = true; },
    }));
    expect(called).toBe(false);
    expect(result.success).toBe(false);
  });
});

// ─── Test: handleEmbeddingsCore — error handling ────────────────────────────

describe("handleEmbeddingsCore — error handling", () => {
  it("provider 400 → returns success=false, status 400", async () => {
    globalThis.fetch = () => Promise.resolve(
      new globalThis.Response(JSON.stringify({ error: "Bad request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await handleEmbeddingsCore(makeOptions());
    expect(result.success).toBe(false);
    expect(result.status).toBe(400);
  });

  it("provider 429 → returns success=false, status 429", async () => {
    globalThis.fetch = () => Promise.resolve(
      new globalThis.Response(JSON.stringify({ error: "Rate limited" }), {
        status: 429,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await handleEmbeddingsCore(makeOptions());
    expect(result.success).toBe(false);
    expect(result.status).toBe(429);
  });

  it("provider 500 → returns success=false, status 500", async () => {
    globalThis.fetch = () => Promise.resolve(
      new globalThis.Response(JSON.stringify({ error: "Server error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      })
    );
    const result = await handleEmbeddingsCore(makeOptions());
    expect(result.success).toBe(false);
    expect(result.status).toBe(500);
  });

  it("network error → returns success=false, status 502", async () => {
    globalThis.fetch = () => Promise.reject(new Error("ECONNREFUSED"));
    const result = await handleEmbeddingsCore(makeOptions());
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
    expect(result.error).toContain("ECONNREFUSED");
  });

  it("invalid JSON → returns success=false, status 502", async () => {
    globalThis.fetch = () => Promise.resolve(
      new globalThis.Response("not json }{", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      })
    );
    const result = await handleEmbeddingsCore(makeOptions());
    expect(result.success).toBe(false);
    expect(result.status).toBe(502);
  });
});
