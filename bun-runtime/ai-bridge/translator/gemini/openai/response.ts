// Translates Gemini streaming response → OpenAI Chat Completions format.
// Written from scratch in TypeScript.

export interface GeminiStreamingState {
  messageId: string;
  model: string;
  textBlockStarted: boolean;
  textBlockIndex: number;
  nextBlockIndex: number;
  messageStarted: boolean;
  messageStopSent: boolean;
  contentAccumulator: string;
}

function newState(): GeminiStreamingState {
  return {
    messageId: `gemini-${Date.now()}`,
    model: "",
    textBlockStarted: false,
    textBlockIndex: -1,
    nextBlockIndex: 0,
    messageStarted: false,
    messageStopSent: false,
    contentAccumulator: "",
  };
}

export function convertGeminiResponseToOpenAI(
  _ctx: unknown,
  _modelName: string,
  _originalRequestRaw: Uint8Array,
  _requestRaw: Uint8Array,
  raw: Uint8Array,
  param: GeminiStreamingState | undefined
): Uint8Array[] {
  const rawText = new TextDecoder().decode(raw).trim();
  if (!rawText) return [];

  // Handle [DONE] or stream end marker
  if (rawText === "[DONE]" || rawText === "data: [DONE]") {
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

  if (parsed.modelVersion) state.model = parsed.modelVersion as string;

  // message_start (only on first chunk)
  if (!state.messageStarted) {
    state.messageStarted = true;
    results.push(new TextEncoder().encode(
      `data: ${JSON.stringify({ id: state.messageId, object: "chat.completion.chunk", model: state.model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`
    ));
  }

  // candidates[0].content.parts → delta
  const candidates = parsed.candidates as Array<Record<string, unknown>> | undefined;
  const firstCandidate = Array.isArray(candidates) ? candidates[0] : undefined;
  if (firstCandidate) {
    const content = firstCandidate.content as Record<string, unknown> | undefined;
    if (content) {
      const parts = content.parts as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (!part || typeof part !== "object") continue;

          // text part
          if (part.text) {
            const text = part.text as string;
            state.contentAccumulator += text;

            const deltaObj = { id: state.messageId, object: "chat.completion.chunk", model: state.model, choices: [{ index: state.nextBlockIndex, delta: { content: text }, finish_reason: null }] };
            results.push(new TextEncoder().encode(`data: ${JSON.stringify(deltaObj)}\n\n`));
          }

          // functionCall → tool_calls delta
          if (part.functionCall) {
            const fc = part.functionCall as Record<string, unknown>;
            const args = fc.args;
            const toolCallIndex = state.nextBlockIndex++;

            results.push(new TextEncoder().encode(
              `data: ${JSON.stringify({
                id: state.messageId,
                object: "chat.completion.chunk",
                model: state.model,
                choices: [{
                  index: toolCallIndex,
                  delta: {
                    tool_calls: [{
                      index: toolCallIndex,
                      id: `${fc.name ?? "tool"}_${Date.now()}`,
                      type: "function",
                      function: { name: fc.name ?? "", arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
                    }],
                  },
                  finish_reason: null,
                }],
              })}\n\n`
            ));
          }
        }
      }
    }
  }

  // done: true → finish_reason
  // Note: finishReason lives inside candidates[0] in the Gemini streaming SSE format
  // STOP and MAX_TOKENS are handled via the [DONE] sentinel in buildDoneEvents.
  // Other reasons (SAFETY, RECITATION, OTHER) are emitted inline here.
  const finishReason = firstCandidate ? (firstCandidate as Record<string, unknown>).finishReason as string | undefined : undefined;
  if (finishReason && finishReason !== "STOP" && finishReason !== "MAX_TOKENS") {
    const mapped = mapGeminiFinishReason(finishReason);
    const usage = parsed.usageMetadata as Record<string, unknown> | undefined;
    const promptTokens = (usage?.promptTokenCount as number) ?? 0;
    const completionTokens = (usage?.candidatesTokenCount as number) ?? 0;

    results.push(new TextEncoder().encode(
      `data: ${JSON.stringify({
        id: state.messageId,
        object: "chat.completion.chunk",
        model: state.model,
        choices: [{ index: 0, delta: {}, finish_reason: mapped }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
      })}\n\n`
    ));
    results.push(new TextEncoder().encode("data: [DONE]\n\n"));
    state.messageStopSent = true;
  }

  return results;
}

export function convertGeminiResponseToOpenAINonStream(
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

  const id = parsed.id as string ?? `gemini-${Date.now()}`;
  const model = parsed.modelVersion as string ?? "";

  const candidates = parsed.candidates as Array<Record<string, unknown>> | undefined;
  let content = "";
  const toolCalls: Array<Record<string, unknown>> = [];

  if (Array.isArray(candidates) && candidates[0]) {
    const candContent = candidates[0]!.content as Record<string, unknown> | undefined;
    if (candContent) {
      const parts = candContent.parts as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(parts)) {
        for (const part of parts) {
          if (part.text) {
            content += part.text as string;
          }
          if (part.functionCall) {
            const fc = part.functionCall as Record<string, unknown>;
            const args = fc.args;
            toolCalls.push({
              id: `${fc.name ?? "tool"}_${Date.now()}`,
              type: "function",
              function: { name: fc.name ?? "", arguments: typeof args === "string" ? args : JSON.stringify(args ?? {}) },
            });
          }
        }
      }
    }
  }

  const finishReason = parsed.finishReason as string | undefined;
  const usage = parsed.usageMetadata as Record<string, unknown> | undefined;

  return new TextEncoder().encode(JSON.stringify({
    id,
    object: "chat.completion",
    model,
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content: content || null,
        ...(toolCalls.length > 0 ? { tool_calls: toolCalls } : {}),
      },
      finish_reason: mapGeminiFinishReason(finishReason ?? "STOP"),
    }],
    usage: {
      prompt_tokens: (usage?.promptTokenCount as number) ?? 0,
      completion_tokens: (usage?.candidatesTokenCount as number) ?? 0,
      total_tokens: (usage?.totalTokenCount as number) ?? 0,
    },
  }));
}

function mapGeminiFinishReason(reason: string): string {
  switch (reason) {
    case "MAX_TOKENS":  return "length";
    case "STOP":        return "stop";
    case "SAFETY":      return "content_filter";
    case "RECITATION":  return "content_filter";
    case "OTHER":       return "stop";
    default:            return "stop";
  }
}

function buildDoneEvents(state: GeminiStreamingState): Uint8Array[] {
  const results: Uint8Array[] = [];
  if (!state.messageStopSent) {
    results.push(new TextEncoder().encode(
      `data: ${JSON.stringify({
        id: state.messageId,
        object: "chat.completion.chunk",
        model: state.model,
        choices: [{ index: 0, delta: {}, finish_reason: "stop" }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
      })}\n\n`
    ));
    results.push(new TextEncoder().encode("data: [DONE]\n\n"));
  }
  return results;
}