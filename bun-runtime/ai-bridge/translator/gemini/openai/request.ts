// Translates Google AI (Gemini) format → OpenAI Chat Completions format.
// Written from scratch in TypeScript.

/**
 * Convert a Gemini API request to OpenAI Chat Completions format.
 * Gemini uses a different content structure:
 * - parts[] instead of content[]
 * - Role is at content level, not part level
 * - Text is in "text" part, images in "inlineData" part
 */
export function convertGeminiRequestToOpenAI(
  modelName: string,
  inputRaw: Uint8Array,
  stream: boolean
): Uint8Array {
  const raw = typeof inputRaw === "string"
    ? JSON.parse(inputRaw)
    : JSON.parse(new TextDecoder().decode(inputRaw));

  const out: Record<string, unknown> = {
    model: modelName,
    messages: [],
    stream,
  };

  // contents → messages
  const contents = raw.contents as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(contents)) {
    for (const content of contents) {
      const role = content.role as string | undefined;
      const parts = content.parts as Array<Record<string, unknown>> | undefined;
      if (!Array.isArray(parts)) continue;

      // Map Gemini role to OpenAI role
      const openaiRole = mapGeminiRole(role);

      for (const part of parts) {
        if (!part || typeof part !== "object") continue;

        // text part
        if (part.text) {
          const text = part.text as string;
          if (text.trim()) {
            (out.messages as Array<Record<string, unknown>>).push({
              role: openaiRole,
              content: text.trim(),
            });
          }
        }

        // inline_data part → image_url
        if (part.inlineData) {
          const data = part.inlineData as Record<string, unknown>;
          const mimeType = data.mimeType as string | undefined ?? "image/jpeg";
          const textData = data.data as string | undefined ?? "";
          (out.messages as Array<Record<string, unknown>>).push({
            role: openaiRole,
            content: [
              {
                type: "image_url",
                image_url: { url: `data:${mimeType};base64,${textData}` },
              },
            ],
          });
        }

        // functionCall → tool_calls
        if (part.functionCall) {
          const fc = part.functionCall as Record<string, unknown>;
          const args = fc.args;
          (out.messages as Array<Record<string, unknown>>).push({
            role: openaiRole,
            content: [
              {
                type: "tool_calls",
                tool_calls: [
                  {
                    id: (fc.name as string ?? "").replace(/\//g, "_") + `_${Date.now()}`,
                    type: "function",
                    function: {
                      name: fc.name ?? "",
                      arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}),
                    },
                  },
                ],
              },
            ],
          });
        }
      }
    }
  }

  // generationConfig → max_tokens, temperature, top_p, stop_sequences
  const genConfig = raw.generationConfig as Record<string, unknown> | undefined;
  if (genConfig) {
    if (genConfig.maxOutputTokens !== undefined) out.max_tokens = genConfig.maxOutputTokens;
    if (genConfig.temperature !== undefined) out.temperature = genConfig.temperature;
    if (genConfig.topP !== undefined) out.top_p = genConfig.topP;
    if (genConfig.stopSequences !== undefined) {
      const seqs = genConfig.stopSequences;
      out.stop = Array.isArray(seqs) ? (seqs.length === 1 ? seqs[0] : seqs) : seqs;
    }
  }

  // system_instruction → system message
  const sysInst = raw.systemInstruction as Record<string, unknown> | undefined;
  if (sysInst) {
    const parts = sysInst.parts as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(parts)) {
      const sysParts: Array<Record<string, unknown>> = [];
      for (const part of parts) {
        if (part.text) {
          sysParts.push({ type: "text", text: part.text as string });
        }
      }
      if (sysParts.length > 0) {
        out.messages = [
          { role: "system", content: sysParts },
          ...(out.messages as Array<Record<string, unknown>>),
        ];
      }
    }
  }

  // tools → functions
  const tools = raw.tools as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tools) && tools.length > 0) {
    const functions: Array<Record<string, unknown>> = [];
    for (const tool of tools) {
      const declarations = tool.functionDeclarations as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(declarations)) {
        for (const decl of declarations) {
          functions.push({
            name: decl.name ?? "",
            description: decl.description ?? "",
            parameters: decl.parameters ?? {},
          });
        }
      }
    }
    if (functions.length > 0) {
      out.tools = functions.map(f => ({ type: "function", function: f }));
    }
  }

  // safetySettings → skip (OpenAI doesn't have equivalent)

  return new TextEncoder().encode(JSON.stringify(out));
}

function mapGeminiRole(role: string | undefined): string {
  if (!role) return "user";
  switch (role.toLowerCase()) {
    case "model": return "assistant";
    case "user": return "user";
    default: return "user";
  }
}
