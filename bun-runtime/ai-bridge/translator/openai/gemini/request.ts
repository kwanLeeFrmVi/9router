// Translates OpenAI Chat Completions format → Gemini API format.
// Written from scratch in TypeScript.

/**
 * Convert an OpenAI Chat Completions request to Gemini format.
 */
export function convertOpenAIRequestToGemini(
  modelName: string,
  inputRaw: Uint8Array,
  stream: boolean
): Uint8Array {
  const raw = typeof inputRaw === "string"
    ? JSON.parse(inputRaw)
    : JSON.parse(new TextDecoder().decode(inputRaw));

  const out: Record<string, unknown> = {
    contents: [],
  };

  // system message → systemInstruction
  const msgs = raw.messages as Array<Record<string, unknown>> | undefined;
  let systemParts: Array<Record<string, unknown>> = [];

  if (Array.isArray(msgs)) {
    for (const msg of msgs) {
      const role = msg.role as string;
      const content = msg.content;

      if (role === "system") {
        if (typeof content === "string" && content.trim()) {
          systemParts.push({ text: content.trim() });
        } else if (Array.isArray(content)) {
          for (const part of content) {
            if (part.type === "text") {
              const text = part.text as string | undefined;
              if (text) systemParts.push({ text });
            }
            if (part.type === "image_url") {
              const img = part.image_url as Record<string, unknown> | undefined;
              const url = img?.url as string | undefined;
              if (url) {
                const { mimeType, data } = parseDataURL(url);
                systemParts.push({ inlineData: { mimeType, data } });
              }
            }
          }
        }
      } else {
        // user / assistant → contents
        const parts = convertOpenAIContentToGeminiParts(content);
        if (parts.length > 0) {
          (out.contents as Array<Record<string, unknown>>).push({
            role: mapOpenAIRoleToGemini(role),
            parts,
          });
        }
      }
    }
  }

  if (systemParts.length > 0) {
    out.systemInstruction = { parts: systemParts };
  }

  // generationConfig
  const genConfig: Record<string, unknown> = {};
  if (raw.max_tokens !== undefined) genConfig.maxOutputTokens = raw.max_tokens;
  if (raw.temperature !== undefined) genConfig.temperature = raw.temperature;
  if (raw.top_p !== undefined) genConfig.topP = raw.top_p;
  if (raw.stop !== undefined) {
    genConfig.stopSequences = Array.isArray(raw.stop) ? raw.stop : [raw.stop];
  }
  if (Object.keys(genConfig).length > 0) {
    out.generationConfig = genConfig;
  }

  // tools → function_declarations
  const tools = raw.tools as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tools) && tools.length > 0) {
    const declarations: Array<Record<string, unknown>> = [];
    for (const tool of tools) {
      if (Array.isArray(tool)) {
        for (const t of tool) {
          const fn = t.function as Record<string, unknown> | undefined;
          if (fn) {
            declarations.push({
              name: fn.name ?? "",
              description: fn.description ?? "",
              parameters: fn.parameters ?? {},
            });
          }
        }
      } else if (tool.function) {
        const fn = tool.function as Record<string, unknown>;
        declarations.push({
          name: fn.name ?? "",
          description: fn.description ?? "",
          parameters: fn.parameters ?? {},
        });
      }
    }
    if (declarations.length > 0) {
      out.tools = [{ functionDeclarations: declarations }];
    }
  }

  // safetySettings (passthrough if present)

  // stream
  out.stream = stream;

  return new TextEncoder().encode(JSON.stringify(out));
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function convertOpenAIContentToGeminiParts(content: unknown): Array<Record<string, unknown>> {
  const parts: Array<Record<string, unknown>> = [];

  if (typeof content === "string" && content.trim()) {
    parts.push({ text: content.trim() });
    return parts;
  }

  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const itemType = obj.type as string;

      if (itemType === "text") {
        const text = obj.text as string | undefined;
        if (text) parts.push({ text });
      } else if (itemType === "image_url") {
        const imgUrl = obj.image_url as Record<string, unknown> | undefined;
        const url = imgUrl?.url as string | undefined;
        if (url) {
          const { mimeType, data } = parseDataURL(url);
          parts.push({ inlineData: { mimeType, data } });
        }
      } else if (itemType === "tool_calls") {
        const calls = obj.tool_calls as Array<Record<string, unknown>> | undefined;
        if (Array.isArray(calls)) {
          for (const tc of calls) {
            const fn = tc.function as Record<string, unknown>;
            const args = fn?.arguments;
            parts.push({
              functionCall: {
                name: fn?.name ?? "",
                args: typeof args === "string" ? JSON.parse(args as string) : (args ?? {}),
              },
            });
          }
        }
      }
    }
  }

  return parts;
}

function mapOpenAIRoleToGemini(role: string): string {
  switch (role) {
    case "model": case "assistant": return "model";
    case "user": return "user";
    case "tool": return "function";
    default: return "user";
  }
}

function parseDataURL(url: string): { mimeType: string; data: string } {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (match) return { mimeType: match[1] ?? "image/jpeg", data: match[2] ?? "" };
  return { mimeType: "application/octet-stream", data: "" };
}
