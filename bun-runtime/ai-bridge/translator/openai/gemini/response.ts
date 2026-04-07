// Translates OpenAI streaming → Gemini streaming format.
// Written from scratch in TypeScript.

export interface OpenAIGeminiState {
  messageId: string;
  model: string;
  roleSet: boolean;
  contentAccumulator: string;
  messageStopSent: boolean;
}

function newState(): OpenAIGeminiState {
  return {
    messageId: `openai-${Date.now()}`,
    model: "",
    roleSet: false,
    contentAccumulator: "",
    messageStopSent: false,
  };
}

export function convertOpenAIResponseToGemini(
  _ctx: unknown,
  _modelName: string,
  _originalRequestRaw: Uint8Array,
  _requestRaw: Uint8Array,
  raw: Uint8Array,
  param: OpenAIGeminiState | undefined
): Uint8Array[] {
  const rawText = new TextDecoder().decode(raw).trim();
  if (!rawText) return [];

  if (rawText === "data: [DONE]") {
    return buildDoneEvents(param ?? newState());
  }

  const stripped = rawText.startsWith("data: ")
    ? rawText.slice(5).trim()
    : rawText;

  if (stripped === "[DONE]") {
    return buildDoneEvents(param ?? newState());
  }

  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }

  const state = param ?? newState();
  const results: Uint8Array[] = [];

  if (parsed.id) state.messageId = parsed.id as string;
  if (parsed.model) state.model = parsed.model as string;

  const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0] as Record<string, unknown> | undefined;
  if (!choice) return [];

  const delta = choice.delta as Record<string, unknown> | undefined;
  const finishReason = choice.finish_reason as string | undefined;

  if (delta) {
    // role → first message
    if (delta.role && !state.roleSet) {
      state.roleSet = true;
      // Gemini doesn't send role in streaming, so we skip
    }

    // content → text part
    const content = delta.content as string | undefined;
    if (content) {
      state.contentAccumulator += content;
      results.push(new TextEncoder().encode(
        `data: ${JSON.stringify({
          candidates: [{
            content: {
              parts: [{ text: content }],
              role: "model",
            },
            finishReason: null,
          }],
        })}\n\n`
      ));
    }

    // tool_calls → functionCall
    const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown>;
        const args = fn?.arguments;
        const argsObj = typeof args === "string"
          ? (() => { try { return JSON.parse(args); } catch { return {}; } })()
          : (args ?? {});

        results.push(new TextEncoder().encode(
          `data: ${JSON.stringify({
            candidates: [{
              content: {
                parts: [{
                  functionCall: {
                    name: fn?.name ?? "",
                    args: argsObj,
                  },
                }],
                role: "model",
              },
              finishReason: null,
            }],
          })}\n\n`
        ));
      }
    }
  }

  // finish_reason → done
  if (finishReason && finishReason !== null) {
    const mapped = mapOpenAIFinishReason(finishReason);
    results.push(new TextEncoder().encode(
      `data: ${JSON.stringify({
        candidates: [{
          content: {
            parts: state.contentAccumulator
              ? [{ text: state.contentAccumulator }]
              : [],
            role: "model",
          },
          finishReason: mapped,
        }],
      })}\n\n`
    ));
    results.push(new TextEncoder().encode("data: [DONE]\n\n"));
    state.messageStopSent = true;
  }

  return results;
}

export function convertOpenAIResponseToGeminiNonStream(
  _ctx: unknown,
  _modelName: string,
  _originalRequestRaw: Uint8Array,
  _requestRaw: Uint8Array,
  raw: Uint8Array
): Uint8Array {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return raw;
  }

  const id = parsed.id as string ?? `openai-${Date.now()}`;
  const model = parsed.model as string ?? "";

  const choices = parsed.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0] as Record<string, unknown> | undefined;
  if (!choice) return raw;

  const message = choice.message as Record<string, unknown> | undefined;
  const finishReason = choice.finish_reason as string | undefined;

  const parts: Array<Record<string, unknown>> = [];
  let content = "";

  if (message) {
    const msgContent = message.content;
    if (typeof msgContent === "string" && msgContent) {
      content = msgContent;
      parts.push({ text: msgContent });
    } else if (Array.isArray(msgContent)) {
      for (const item of msgContent) {
        if (!item || typeof item !== "object") continue;
        const obj = item as Record<string, unknown>;
        if (obj.type === "text") {
          const text = obj.text as string | undefined;
          if (text) {
            content += text;
            parts.push({ text });
          }
        }
        if (obj.type === "tool_calls") {
          const calls = obj.tool_calls as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(calls)) {
            for (const tc of calls) {
              const fn = tc.function as Record<string, unknown>;
              const args = fn?.arguments;
              const argsObj = typeof args === "string"
                ? (() => { try { return JSON.parse(args); } catch { return {}; } })()
                : (args ?? {});
              parts.push({
                functionCall: { name: fn?.name ?? "", args: argsObj },
              });
            }
          }
        }
      }
    }

    const toolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(toolCalls)) {
      for (const tc of toolCalls) {
        const fn = tc.function as Record<string, unknown>;
        const args = fn?.arguments;
        const argsObj = typeof args === "string"
          ? (() => { try { return JSON.parse(args); } catch { return {}; } })()
          : (args ?? {});
        parts.push({
          functionCall: { name: fn?.name ?? "", args: argsObj },
        });
      }
    }
  }

  const usage = parsed.usage as Record<string, unknown> | undefined;

  return new TextEncoder().encode(JSON.stringify({
    id,
    modelVersion: model,
    candidates: [{
      content: { parts, role: "model" },
      finishReason: mapOpenAIFinishReason(finishReason ?? "stop"),
    }],
    usageMetadata: {
      promptTokenCount: (usage?.prompt_tokens as number) ?? 0,
      candidatesTokenCount: (usage?.completion_tokens as number) ?? 0,
      totalTokenCount: (usage?.total_tokens as number) ?? 0,
    },
  }));
}

function mapOpenAIFinishReason(reason: string): string {
  switch (reason) {
    case "stop":        return "STOP";
    case "length":      return "MAX_TOKENS";
    case "tool_calls":  return "STOP";
    case "content_filter": return "SAFETY";
    default:            return "STOP";
  }
}

function buildDoneEvents(state: OpenAIGeminiState): Uint8Array[] {
  const results: Uint8Array[] = [];
  if (!state.messageStopSent) {
    if (state.contentAccumulator) {
      results.push(new TextEncoder().encode(
        `data: ${JSON.stringify({
          candidates: [{
            content: { parts: [{ text: state.contentAccumulator }], role: "model" },
            finishReason: "STOP",
          }],
        })}\n\n`
      ));
    }
    results.push(new TextEncoder().encode("data: [DONE]\n\n"));
  }
  return results;
}