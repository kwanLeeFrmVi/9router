// Translates Ollama SSE streaming → Anthropic SSE format
// Ollama sends: data: {"model":"...","done":false,"message":{"role":"assistant","content":"..."}}

export interface OllamaStreamingState {
  messageId: string;
  model: string;
  textBlockStarted: boolean;
  textBlockIndex: number;
  nextBlockIndex: number;
  messageStarted: boolean;
  messageStopSent: boolean;
  contentAccumulator: string;
}

function newState(): OllamaStreamingState {
  return {
    messageId: `ollama-${Date.now()}`,
    model: "",
    textBlockStarted: false,
    textBlockIndex: -1,
    nextBlockIndex: 0,
    messageStarted: false,
    messageStopSent: false,
    contentAccumulator: "",
  };
}

export function convertOllamaResponseToClaude(
  _ctx: unknown,
  _modelName: string,
  _originalRequestRaw: Uint8Array,
  _requestRaw: Uint8Array,
  raw: Uint8Array,
  param: OllamaStreamingState | undefined
): Uint8Array[] {
  const rawText = new TextDecoder().decode(raw).trim();
  if (!rawText) return [];

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

  if (parsed.model) state.model = parsed.model as string;

  // message_start
  if (!state.messageStarted) {
    state.messageStarted = true;
    results.push(buildSSEEvent("message_start", {
      type: "message_start",
      message: {
        id: state.messageId,
        type: "message",
        role: "assistant",
        model: state.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    }));
  }

  const message = parsed.message as Record<string, unknown> | undefined;
  if (message) {
    const content = message.content as string | undefined;
    if (content) {
      // Start text block if not started
      if (!state.textBlockStarted) {
        state.textBlockIndex = state.nextBlockIndex++;
        state.textBlockStarted = true;
        results.push(buildSSEEvent("content_block_start", {
          type: "content_block_start",
          index: state.textBlockIndex,
          content_block: { type: "text", text: "" },
        }));
      }

      results.push(buildSSEEvent("content_block_delta", {
        type: "content_block_delta",
        index: state.textBlockIndex,
        delta: { type: "text_delta", text: content },
      }));
      state.contentAccumulator += content;
    }
  }

  // done
  if (parsed.done === true) {
    const doneReason = parsed.done_reason as string | undefined;
    const stopReason = doneReason === "length" ? "max_tokens" : "end_turn";

    // Stop text block
    if (state.textBlockStarted) {
      results.push(buildSSEEvent("content_block_stop", {
        type: "content_block_stop",
        index: state.textBlockIndex,
      }));
      state.textBlockStarted = false;
    }

    results.push(buildSSEEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: stopReason, stop_sequence: null },
      usage: { input_tokens: 0, output_tokens: 0 },
    }));

    results.push(buildSSEEvent("message_stop", { type: "message_stop" }));
    state.messageStopSent = true;
  }

  return results;
}

export function convertOllamaResponseToClaudeNonStream(
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

  const message = parsed.message as Record<string, unknown> | undefined;
  const content = (message?.content as string | undefined) ?? "";
  const model = (parsed.model as string | undefined) ?? "";

  return new TextEncoder().encode(JSON.stringify({
    id: `ollama-${Date.now()}`,
    type: "message",
    role: "assistant",
    model,
    content: [{ type: "text", text: content }],
    stop_reason: parsed.done_reason === "length" ? "max_tokens" : "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  }));
}

function buildSSEEvent(event: string, payload: object): Uint8Array {
  const text = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  return new TextEncoder().encode(text);
}

function buildDoneEvents(state: OllamaStreamingState): Uint8Array[] {
  const results: Uint8Array[] = [];
  if (state.textBlockStarted) {
    results.push(buildSSEEvent("content_block_stop", {
      type: "content_block_stop",
      index: state.textBlockIndex,
    }));
  }
  if (!state.messageStopSent) {
    results.push(buildSSEEvent("message_delta", {
      type: "message_delta",
      delta: { stop_reason: "end_turn", stop_sequence: null },
      usage: { input_tokens: 0, output_tokens: 0 },
    }));
    results.push(buildSSEEvent("message_stop", { type: "message_stop" }));
  }
  return results;
}