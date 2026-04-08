/**
 * Unit tests for ai-bridge request translators (Request() registry).
 * Uses Bun's native test runner.
 */

import { Request, NeedsTranslation } from "../../ai-bridge/translator/index.ts";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function encode(body: unknown): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(body));
}

function decode(arr: Uint8Array): unknown {
  return JSON.parse(new TextDecoder().decode(arr));
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("NeedsTranslation", () => {
  it("returns false for same format", () => {
    expect(NeedsTranslation("openai", "openai")).toBe(false);
    expect(NeedsTranslation("claude", "claude")).toBe(false);
    expect(NeedsTranslation("gemini", "gemini")).toBe(false);
  });

  it("returns true for different formats", () => {
    expect(NeedsTranslation("openai", "claude")).toBe(true);
    expect(NeedsTranslation("claude", "openai")).toBe(true);
    expect(NeedsTranslation("gemini", "openai")).toBe(true);
    expect(NeedsTranslation("openai", "gemini")).toBe(true);
  });
});

describe("openai → claude (Request)", () => {
  it("converts string content to text block", () => {
    const body = { model: "claude-sonnet-4", messages: [{ role: "user", content: "hello" }] };
    const result = decode(Request("openai", "claude", "claude-sonnet-4-20250514", encode(body), false)) as Record<string, unknown>;

    expect(result.model).toBe("claude-sonnet-4-20250514");
    expect(result.messages).toBeDefined();
    const msgs = result.messages as Array<Record<string, unknown>>;
    expect(msgs[0].role).toBe("user");
    expect(Array.isArray(msgs[0].content)).toBe(true);
    const content = msgs[0].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("hello");
  });

  it("maps image_url to base64 data URL", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [{
        role: "user",
        content: [{
          type: "image_url",
          image_url: { url: "data:image/png;base64,abc123" },
        }],
      }],
    };
    const result = decode(Request("openai", "claude", "claude-sonnet-4-20250514", encode(body), false)) as Record<string, unknown>;
    const msgs = result.messages as Array<Record<string, unknown>>;
    const content = msgs[0].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("image");
    expect((content[0].source as Record<string, unknown>).type).toBe("base64");
    expect((content[0].source as Record<string, unknown>).media_type).toBe("image/png");
    expect((content[0].source as Record<string, unknown>).data).toBe("abc123");
  });

  it("maps tool_calls to tool_use", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "use the weather tool" }],
      tools: [{
        type: "function",
        function: { name: "get_weather", description: "Get weather", parameters: { type: "object" } },
      }],
    };
    const result = decode(Request("openai", "claude", "claude-sonnet-4-20250514", encode(body), false)) as Record<string, unknown>;
    expect(result.tools).toBeDefined();
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools[0].name).toBe("get_weather");
    expect(tools[0].input_schema).toBeDefined();
  });

  it("maps reasoning_effort to thinking budget", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "explain physics" }],
      reasoning_effort: "high",
    };
    const result = decode(Request("openai", "claude", "claude-sonnet-4-20250514", encode(body), false)) as Record<string, unknown>;
    expect(result.thinking).toBeDefined();
    const thinking = result.thinking as Record<string, unknown>;
    expect(thinking.type).toBe("enabled");
    expect(thinking.budget_tokens).toBeGreaterThan(0);
  });

  it("maps max_tokens → max_tokens, temperature, stop", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
      temperature: 0.7,
      stop: ["END"],
    };
    const result = decode(Request("openai", "claude", "claude-sonnet-4-20250514", encode(body), false)) as Record<string, unknown>;
    expect(result.max_tokens).toBe(1024);
    expect(result.temperature).toBe(0.7);
    expect(result.stop_sequences).toEqual(["END"]);
  });

  it("extracts system message from messages array", () => {
    const body = {
      model: "claude-sonnet-4",
      messages: [
        { role: "system", content: "You are helpful." },
        { role: "user", content: "hello" },
      ],
    };
    const result = decode(Request("openai", "claude", "claude-sonnet-4-20250514", encode(body), false)) as Record<string, unknown>;
    expect(result.system).toBeDefined();
    expect(result.messages).toBeDefined();
    const msgs = result.messages as Array<Record<string, unknown>>;
    // System should be removed from messages
    expect(msgs.find(m => (m.role as string) === "system")).toBeUndefined();
  });
});

describe("claude → openai (Request)", () => {
  it("maps text block array to openai content array", () => {
    const body = {
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [{ type: "text", text: "hi" }],
      }],
    };
    const result = decode(Request("claude", "openai", "gpt-4o", encode(body), false)) as Record<string, unknown>;

    expect(result.model).toBe("gpt-4o");
    const msgs = result.messages as Array<Record<string, unknown>>;
    expect(msgs[0].role).toBe("user");
    // ai-bridge preserves array content structure
    expect(Array.isArray(msgs[0].content)).toBe(true);
    const content = msgs[0].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
    expect(content[0].text).toBe("hi");
  });

  it("preserves multimodal arrays (text + image)", () => {
    const body = {
      model: "gpt-4o",
      messages: [{
        role: "user",
        content: [
          { type: "text", text: "describe" },
          { type: "image", source: { type: "base64", media_type: "image/png", data: "ZmFrZQ==" } },
        ],
      }],
    };
    const result = decode(Request("claude", "openai", "gpt-4o", encode(body), false)) as Record<string, unknown>;
    const msgs = result.messages as Array<Record<string, unknown>>;
    expect(Array.isArray(msgs[0].content)).toBe(true);
    const content = msgs[0].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("text");
    expect(content[1].type).toBe("image_url");
  });

  it("maps tools (Claude) to functions (OpenAI)", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      tools: [{
        name: "search",
        description: "Search the web",
        input_schema: { type: "object", properties: { query: { type: "string" } } },
      }],
    };
    const result = decode(Request("claude", "openai", "gpt-4o", encode(body), false)) as Record<string, unknown>;
    expect(result.tools).toBeDefined();
    const tools = result.tools as Array<Record<string, unknown>>;
    expect(tools[0].type).toBe("function");
    expect((tools[0] as Record<string, unknown>).function).toBeDefined();
    const fn = (tools[0] as Record<string, unknown>).function as Record<string, unknown>;
    expect(fn.name).toBe("search");
  });

  it("maps thinking budget → reasoning_effort", () => {
    const body = {
      model: "gpt-4o",
      messages: [{ role: "user", content: "hi" }],
      thinking: { type: "enabled", budget_tokens: 10000 },
    };
    const result = decode(Request("claude", "openai", "gpt-4o", encode(body), false)) as Record<string, unknown>;
    expect(result.reasoning_effort).toBeDefined();
    expect(typeof result.reasoning_effort).toBe("string");
  });
});

describe("gemini → openai (Request)", () => {
  it("maps contents.parts.text to messages", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hello gemini" }] }],
    };
    const result = decode(Request("gemini", "openai", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    expect(result.model).toBe("gemini-2.0-flash");
    const msgs = result.messages as Array<Record<string, unknown>>;
    expect(msgs[0].role).toBe("user");
    expect(msgs[0].content).toBe("hello gemini");
  });

  it("maps inlineData to image_url", () => {
    const body = {
      contents: [{
        role: "user",
        parts: [{
          inlineData: { mimeType: "image/jpeg", data: "SGVsbG8=" },
        }],
      }],
    };
    const result = decode(Request("gemini", "openai", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    const msgs = result.messages as Array<Record<string, unknown>>;
    expect(Array.isArray(msgs[0].content)).toBe(true);
    const content = msgs[0].content as Array<Record<string, unknown>>;
    expect(content[0].type).toBe("image_url");
    expect((content[0].image_url as Record<string, unknown>).url).toContain("data:image/jpeg;base64,SGVsbG8=");
  });

  it("maps generationConfig → max_tokens, temperature", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.5 },
    };
    const result = decode(Request("gemini", "openai", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    expect(result.max_tokens).toBe(2048);
    expect(result.temperature).toBe(0.5);
  });

  it("maps systemInstruction → system message", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      systemInstruction: { parts: [{ text: "You are an assistant." }] },
    };
    const result = decode(Request("gemini", "openai", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    const msgs = result.messages as Array<Record<string, unknown>>;
    expect(msgs[0].role).toBe("system");
    expect((msgs[0].content as Array<Record<string, unknown>>)[0].text).toBe("You are an assistant.");
  });

  it("maps tools.functionDeclarations → tools.functions", () => {
    const body = {
      contents: [{ role: "user", parts: [{ text: "hi" }] }],
      tools: [{ functionDeclarations: [{
        name: "calc",
        description: "Calculator",
        parameters: { type: "object" },
      }] }],
    };
    const result = decode(Request("gemini", "openai", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    expect(result.tools).toBeDefined();
    const tools = result.tools as Array<Record<string, unknown>>;
    expect((tools[0] as Record<string, unknown>).function).toBeDefined();
  });
});

describe("openai → gemini (Request)", () => {
  it("maps messages to contents.parts[]", () => {
    const body = {
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hello gemini" }],
    };
    const result = decode(Request("openai", "gemini", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    expect(result.contents).toBeDefined();
    const contents = result.contents as Array<Record<string, unknown>>;
    expect(contents[0].role).toBe("user");
    expect(Array.isArray(contents[0].parts)).toBe(true);
    expect((contents[0].parts as Array<Record<string, unknown>>)[0].text).toBe("hello gemini");
  });

  it("maps system message to systemInstruction", () => {
    const body = {
      model: "gemini-2.0-flash",
      messages: [
        { role: "system", content: "You are great." },
        { role: "user", content: "hello" },
      ],
    };
    const result = decode(Request("openai", "gemini", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    expect(result.systemInstruction).toBeDefined();
    expect((result.systemInstruction as Record<string, unknown>).parts).toBeDefined();
  });

  it("maps max_tokens → maxOutputTokens", () => {
    const body = {
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
      max_tokens: 1024,
    };
    const result = decode(Request("openai", "gemini", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    expect(result.generationConfig).toBeDefined();
    const gc = result.generationConfig as Record<string, unknown>;
    expect(gc.maxOutputTokens).toBe(1024);
  });

  it("maps tools → functionDeclarations", () => {
    const body = {
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: "hi" }],
      tools: [{
        type: "function",
        function: { name: "search", description: "Web search", parameters: { type: "object" } },
      }],
    };
    const result = decode(Request("openai", "gemini", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    expect(result.tools).toBeDefined();
  });
});

describe("passthrough identity", () => {
  it("openai → openai returns body unchanged", () => {
    const body = { model: "gpt-4o", messages: [{ role: "user", content: "hi" }] };
    const result = decode(Request("openai", "openai", "gpt-4o", encode(body), false)) as Record<string, unknown>;
    expect(result.model).toBe("gpt-4o");
    expect(result.messages).toEqual(body.messages);
  });

  it("claude → claude returns body unchanged", () => {
    const body = { model: "claude-sonnet-4", messages: [{ role: "user", content: "hi" }] };
    const result = decode(Request("claude", "claude", "claude-sonnet-4-20250514", encode(body), false)) as Record<string, unknown>;
    expect(result.model).toBe("claude-sonnet-4");
  });

  it("gemini → gemini returns body unchanged", () => {
    const body = { contents: [{ role: "user", parts: [{ text: "hi" }] }] };
    const result = decode(Request("gemini", "gemini", "gemini-2.0-flash", encode(body), false)) as Record<string, unknown>;
    expect(result.contents).toEqual(body.contents);
  });
});
