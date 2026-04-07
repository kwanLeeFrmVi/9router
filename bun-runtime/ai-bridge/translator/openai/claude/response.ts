// Translates Anthropic SSE streaming response → OpenAI Chat Completions format.
// Written from scratch in TypeScript.
import { sanitizeClaudeToolID } from "../../util/index.ts";

// ─── State machine ───────────────────────────────────────────────────────────────

export interface OpenAIStreamingState {
  messageId: string;
  model: string;
  finishReason: string;
  finishReasonSent: boolean;
  messageStopSent: boolean;

  // Content blocks
  textIndex: number;
  textStarted: boolean;
  thinkingIndex: number;
  thinkingStarted: boolean;
  contentBlocksStopped: boolean;

  // Tool calls
  toolCallIndex: number;
  toolCallsStarted: boolean;
  toolCallBlockIndex: number;
  currentToolIndex: number;

  // Accumulator
  contentAccumulator: string;
  toolArgumentsAccumulator: string;
  currentToolName: string;
  currentToolId: string;
}

function newState(): OpenAIStreamingState {
  return {
    messageId: "",
    model: "",
    finishReason: "",
    finishReasonSent: false,
    messageStopSent: false,
    textIndex: -1,
    textStarted: false,
    thinkingIndex: -1,
    thinkingStarted: false,
    contentBlocksStopped: false,
    toolCallIndex: -1,
    toolCallsStarted: false,
    toolCallBlockIndex: -1,
    currentToolIndex: -11,
    contentAccumulator: "",
    toolArgumentsAccumulator: "",
    currentToolName: "",
    currentToolId: "",
  };
}

export function convertClaudeResponseToOpenAI(
  _ctx: unknown,
  _modelName: string,
  _originalRequestRaw: Uint8Array,
  _requestRaw: Uint8Array,
  raw: Uint8Array,
  param: OpenAIStreamingState | undefined
): Uint8Array[] {
  const rawText = new TextDecoder().decode(raw).trim();
  if (!rawText) return [];

  // Parse SSE: extract event name and data
  const lines = rawText.split("\n");
  let _eventType = "";
  let dataLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith("event:")) {
      _eventType = line.slice(5).trim();
    } else if (line.startsWith("data:")) {
      dataLines.push(line.slice(4).trim());
    }
  }

  if (dataLines.length === 0) return [];

  const state = param ?? newState();
  const results: Uint8Array[] = [];

  for (const dataStr of dataLines) {
    let event: Record<string, unknown>;
    try {
      event = JSON.parse(dataStr);
    } catch {
      continue;
    }

    const type = event.type as string;
    if (!type) continue;

    // Initialize from message_start
    if (type === "message_start") {
      const msg = event.message as Record<string, unknown> | undefined;
      if (msg) {
        state.messageId = msg.id as string ?? "";
        state.model = msg.model as string ?? "";
      }
      // Always emit OpenAI "data: {...}\n\n" format
      results.push(new TextEncoder().encode(
        `data: ${JSON.stringify({ id: state.messageId, object: "chat.completion.chunk", model: state.model, choices: [{ index: 0, delta: { role: "assistant", content: "" }, finish_reason: null }] })}\n\n`
      ));
      continue;
    }

    // content_block_start
    if (type === "content_block_start") {
      const index = event.index as number | undefined ?? 0;
      const contentBlock = event.content_block as Record<string, unknown> | undefined;
      if (!contentBlock) continue;

      const blockType = contentBlock.type as string;

      if (blockType === "text") {
        state.textIndex = index;
        state.textStarted = true;
        // OpenAI: no content_block_start equivalent, just start delta with empty
      } else if (blockType === "thinking") {
        state.thinkingIndex = index;
        state.thinkingStarted = true;
        // OpenAI has no thinking block, skip
      } else if (blockType === "tool_use") {
        state.toolCallBlockIndex = index;
        state.toolCallsStarted = true;
        state.currentToolIndex = state.toolCallIndex++;
        state.currentToolName = contentBlock.name as string ?? "";
        state.currentToolId = contentBlock.id as string ?? "";
        state.toolArgumentsAccumulator = "";
      }
      continue;
    }

    // content_block_delta
    if (type === "content_block_delta") {
      const index = event.index as number | undefined ?? 0;
      const delta = event.delta as Record<string, unknown> | undefined;
      if (!delta) continue;

      const deltaType = delta.type as string;

      // text_delta → assistant message delta
      if (deltaType === "text_delta") {
        const text = delta.text as string | undefined ?? "";
        state.contentAccumulator += text;

        results.push(new TextEncoder().encode(
          `data: ${JSON.stringify({ id: state.messageId, object: "chat.completion.chunk", model: state.model, choices: [{ index, delta: { content: text }, finish_reason: null }] })}\n\n`
        ));
      }

      // thinking_delta → skip (OpenAI doesn't have thinking content)
      if (deltaType === "thinking_delta") {
        // OpenAI doesn't support thinking blocks natively, skip
      }

      // input_json_delta → accumulate tool call arguments
      if (deltaType === "input_json_delta") {
        const partialJson = delta.partial_json as string | undefined ?? "";
        state.toolArgumentsAccumulator += partialJson;
        // OpenAI tool call chunks use function.arguments
        results.push(new TextEncoder().encode(
          `data: ${JSON.stringify({ id: state.messageId, object: "chat.completion.chunk", model: state.model, choices: [{ index, delta: { tool_calls: [{ index: state.currentToolIndex, id: state.currentToolId, type: "function", function: { name: state.currentToolName, arguments: partialJson } }] }, finish_reason: null }] })}\n\n`
        ));
      }
      continue;
    }

    // content_block_stop
    if (type === "content_block_stop") {
      // Stop thinking block
      if (state.thinkingStarted && state.thinkingIndex === (event.index as number | undefined ?? -1)) {
        state.thinkingStarted = false;
      }
      // Stop text block
      if (state.textStarted && state.textIndex === (event.index as number | undefined ?? -1)) {
        state.textStarted = false;
      }
      // Stop tool call block
      if (state.toolCallsStarted && state.toolCallBlockIndex === (event.index as number | undefined ?? -1)) {
        state.toolCallsStarted = false;
      }
      continue;
    }

    // message_delta
    if (type === "message_delta") {
      const delta = event.delta as Record<string, unknown> | undefined;
      if (delta) {
        const reason = delta.stop_reason as string | undefined;
        if (reason) {
          state.finishReason = mapClaudeStopReason(reason);
        }
      }
      const usage = event.usage as Record<string, unknown> | undefined;
      if (usage && !state.finishReasonSent) {
        state.finishReasonSent = true;
        results.push(new TextEncoder().encode(
          `data: ${JSON.stringify({ id: state.messageId, object: "chat.completion.chunk", model: state.model, choices: [{ index: 0, delta: {}, finish_reason: state.finishReason }], usage: { prompt_tokens: usage.input_tokens ?? 0, completion_tokens: usage.output_tokens ?? 0, total_tokens: ((usage.input_tokens as number) ?? 0) + ((usage.output_tokens as number) ?? 0) } })}\n\n`
        ));
      }
      continue;
    }

    // message_stop
    if (type === "message_stop") {
      state.messageStopSent = true;
      results.push(new TextEncoder().encode("data: [DONE]\n\n"));
      continue;
    }
  }

  return results;
}

export function convertClaudeResponseToOpenAINonStream(
  _ctx: unknown,
  _modelName: string,
  _originalRequestRaw: Uint8Array,
  _requestRaw: Uint8Array,
  raw: Uint8Array
): Uint8Array {
  // Parse as Claude message format
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(new TextDecoder().decode(raw));
  } catch {
    return raw;
  }

  const id = parsed.id as string ?? "";
  const model = parsed.model as string ?? "";
  const content = parsed.content as Array<Record<string, unknown>> | undefined;

  const message: Record<string, unknown> = { role: "assistant", content: "" };
  const toolCalls: Array<Record<string, unknown>> = [];
  const parts: string[] = [];

  if (Array.isArray(content)) {
    for (const block of content) {
      const blockType = block.type as string;
      if (blockType === "text") {
        const text = block.text as string | undefined ?? "";
        parts.push(text);
      } else if (blockType === "tool_use") {
        const fn = block as Record<string, unknown>;
        const argsRaw = fn.input as string | undefined;
        let argsObj: Record<string, unknown> = {};
        if (typeof argsRaw === "string") {
          try { argsObj = JSON.parse(argsRaw); } catch { /* ignore */ }
        } else if (typeof argsRaw === "object") {
          argsObj = argsRaw;
        }
        toolCalls.push({
          id: sanitizeClaudeToolID(fn.id as string ?? ""),
          type: "function",
          function: {
            name: fn.name ?? "",
            arguments: typeof argsRaw === "string" ? argsRaw : JSON.stringify(argsObj),
          },
        });
      } else if (blockType === "thinking") {
        // OpenAI doesn't have thinking content, skip
      }
    }
  }

  const stopReason = mapClaudeStopReason(parsed.stop_reason as string ?? "");
  const hasContent = parts.length > 0 || toolCalls.length > 0;

  if (hasContent) {
    if (parts.length > 0) {
      message.content = parts.join("\n");
    } else {
      message.content = null;
    }
    if (toolCalls.length > 0) {
      message.tool_calls = toolCalls;
    }
  }

  const usage = parsed.usage as Record<string, unknown> | undefined;
  const usageObj: Record<string, unknown> = {
    prompt_tokens: (usage?.input_tokens as number) ?? 0,
    completion_tokens: (usage?.output_tokens as number) ?? 0,
    total_tokens: ((usage?.input_tokens as number) ?? 0) + ((usage?.output_tokens as number) ?? 0),
  };

  return new TextEncoder().encode(JSON.stringify({
    id,
    object: "chat.completion",
    model,
    choices: [{
      index: 0,
      message,
      finish_reason: stopReason,
    }],
    usage: usageObj,
  }));
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function mapClaudeStopReason(reason: string): string {
  switch (reason) {
    case "end_turn":   return "stop";
    case "max_tokens": return "length";
    case "tool_use":   return "tool_calls";
    default:           return "stop";
  }
}