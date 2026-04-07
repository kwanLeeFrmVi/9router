// Translates OpenAI Chat Completions streaming response → Anthropic SSE format.
// Written from scratch in TypeScript with proper TypeScript types.
// Handles SSE chunk accumulation, content block state machines, and tool call assembly.

import { appendSSEEventBytes } from "../../common/sse.ts";
import { extractTokensFromOpenAIUsage } from "../../common/tokens.ts";
import { fixPartialJSON, sanitizeClaudeToolID } from "../../util/index.ts";

// ─── State machine for streaming translation ──────────────────────────────────

export interface StreamingState {
  messageId: string;
  model: string;
  createdAt: number;
  sawToolCall: boolean;
  finishReason: string;
  toolNameMap: Map<string, string>;

  // Content block tracking
  textBlockIndex: number;
  thinkingBlockIndex: number;
  nextBlockIndex: number;
  textBlockStarted: boolean;
  thinkingBlockStarted: boolean;
  contentBlocksStopped: boolean;

  // Tool call tracking (index → accumulator)
  toolCalls: Map<number, ToolCallAccumulator>;
  toolBlockIndexes: Map<number, number>;
  toolBlockStopped: Map<number, boolean>;

  // Message lifecycle
  messageStarted: boolean;
  messageDeltaSent: boolean;
  messageStopSent: boolean;

  // Accumulator for text content
  contentAccumulator: string;
}

interface ToolCallAccumulator {
  id: string;
  name: string;
  arguments: string;
}

function newState(): StreamingState {
  return {
    messageId: "",
    model: "",
    createdAt: 0,
    sawToolCall: false,
    finishReason: "",
    toolNameMap: new Map(),
    textBlockIndex: -1,
    thinkingBlockIndex: -1,
    nextBlockIndex: 0,
    textBlockStarted: false,
    thinkingBlockStarted: false,
    contentBlocksStopped: false,
    toolCalls: new Map(),
    toolBlockIndexes: new Map(),
    toolBlockStopped: new Map(),
    messageStarted: false,
    messageDeltaSent: false,
    messageStopSent: false,
    contentAccumulator: "",
  };
}

// ─── Main export ──────────────────────────────────────────────────────────────

/**
 * Convert an OpenAI streaming chunk to one or more Anthropic SSE event lines.
 * param is a StreamingState that carries accumulated state across chunks.
 */
export function convertOpenAIResponseToClaude(
  _ctx: unknown,
  _modelName: string,
  originalRequestRaw: Uint8Array,
  _requestRaw: Uint8Array,
  raw: Uint8Array,
  param: StreamingState | undefined
): Uint8Array[] {
  // Decode raw chunk
  const rawText = new TextDecoder().decode(raw);

  // Strip "data: " prefix
  const stripped = rawText.startsWith("data: ")
    ? rawText.slice(5).trim()
    : rawText.trim();

  // Handle [DONE] marker
  if (stripped === "[DONE]") {
    return buildDoneEvents(param ?? newState());
  }

  // Parse JSON
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripped);
  } catch {
    return [];
  }

  // Initialize state on first chunk
  const state: StreamingState = param ?? newState();
  if (!state.messageId && parsed.id) state.messageId = parsed.id as string;
  if (!state.model && parsed.model) state.model = parsed.model as string;
  if (state.createdAt === 0 && parsed.created) state.createdAt = parsed.created as number;

  const results: Uint8Array[] = [];
  const delta = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0]?.delta as Record<string, unknown> | undefined;
  if (!delta) return results;

  // ── message_start: send on very first chunk ─────────────────────────────────
  if (!state.messageStarted) {
    results.push(appendSSEEventBytes(
      new Uint8Array(),
      "message_start",
      {
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
      },
      2
    ));
    state.messageStarted = true;
  }

  // ── Reasoning content → thinking content block ────────────────────────────────
  const reasoning = delta.reasoning_content;
  if (reasoning) {
    const texts = collectReasoningTexts(reasoning);
    for (const text of texts) {
      if (!text) continue;

      stopTextBlock(state, results);

      if (!state.thinkingBlockStarted) {
        state.thinkingBlockIndex = state.nextBlockIndex++;
        results.push(appendSSEEventBytes(
          new Uint8Array(),
          "content_block_start",
          {
            type: "content_block_start",
            index: state.thinkingBlockIndex,
            content_block: { type: "thinking", thinking: "" },
          },
          2
        ));
        state.thinkingBlockStarted = true;
      }

      results.push(appendSSEEventBytes(
        new Uint8Array(),
        "content_block_delta",
        {
          type: "content_block_delta",
          index: state.thinkingBlockIndex,
          delta: { type: "thinking_delta", thinking: text },
        },
        2
      ));
    }
  }

  // ── Text content ─────────────────────────────────────────────────────────────
  const content = delta.content;
  if (typeof content === "string" && content) {
    stopThinkingBlock(state, results);

    if (!state.textBlockStarted) {
      state.textBlockIndex = state.nextBlockIndex++;
      results.push(appendSSEEventBytes(
        new Uint8Array(),
        "content_block_start",
        {
          type: "content_block_start",
          index: state.textBlockIndex,
          content_block: { type: "text", text: "" },
        },
        2
      ));
      state.textBlockStarted = true;
    }

    results.push(appendSSEEventBytes(
      new Uint8Array(),
      "content_block_delta",
      {
        type: "content_block_delta",
        index: state.textBlockIndex,
        delta: { type: "text_delta", text: content },
      },
      2
    ));
    state.contentAccumulator += content;
  }

  // ── Tool calls ────────────────────────────────────────────────────────────────
  const toolCalls = delta.tool_calls as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(toolCalls)) {
    if (state.toolCalls.size === 0) {
      // Build tool name map from original request on first tool call
      buildToolNameMap(state, originalRequestRaw);
    }

    for (const tc of toolCalls) {
      state.sawToolCall = true;
      const index = (tc.index as number | undefined) ?? 0;

      if (!state.toolCalls.has(index)) {
        state.toolCalls.set(index, { id: "", name: "", arguments: "" });
      }
      const accum = state.toolCalls.get(index)!;

      if (tc.id && !accum.id) accum.id = tc.id as string;
      if (tc.function) {
        const fn = tc.function as Record<string, unknown>;
        if (fn.name && !accum.name) {
          accum.name = mapToolName(state.toolNameMap, fn.name as string);
        }
        if (fn.arguments) {
          accum.arguments += fn.arguments as string;
        }
      }

      // Stop thinking/text blocks when a new tool call appears
      stopThinkingBlock(state, results);
      stopTextBlock(state, results);

      // Start tool_use content block (once per tool_call)
      if (!state.toolBlockIndexes.has(index)) {
        const blockIndex = state.nextBlockIndex++;
        state.toolBlockIndexes.set(index, blockIndex);
        state.toolBlockStopped.set(index, false);

        results.push(appendSSEEventBytes(
          new Uint8Array(),
          "content_block_start",
          {
            type: "content_block_start",
            index: blockIndex,
            content_block: {
              type: "tool_use",
              id: sanitizeClaudeToolID(accum.id),
              name: accum.name,
              input: {},
            },
          },
          2
        ));
      }
    }
  }

  // ── finish_reason ─────────────────────────────────────────────────────────────
  const finishReason = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0]?.finish_reason as string | undefined;
  if (finishReason) {
    state.finishReason = state.sawToolCall ? "tool_calls" : finishReason;

    // Stop thinking block
    stopThinkingBlock(state, results);

    // Stop text block
    stopTextBlock(state, results);

    // Stop all tool calls with accumulated arguments
    if (!state.contentBlocksStopped) {
      for (const [index, accum] of state.toolCalls) {
        const blockIndex = state.toolBlockIndexes.get(index);
        if (blockIndex === undefined || state.toolBlockStopped.get(index)) continue;

        if (accum.arguments) {
          results.push(appendSSEEventBytes(
            new Uint8Array(),
            "content_block_delta",
            {
              type: "content_block_delta",
              index: blockIndex,
              delta: {
                type: "input_json_delta",
                partial_json: fixPartialJSON(accum.arguments),
              },
            },
            2
          ));
        }
        results.push(appendSSEEventBytes(
          new Uint8Array(),
          "content_block_stop",
          { type: "content_block_stop", index: blockIndex },
          2
        ));
        state.toolBlockStopped.set(index, true);
      }
      state.contentBlocksStopped = true;
    }
  }

  // ── usage info (may come in a later chunk) ─────────────────────────────────
  const usage = parsed.usage as Record<string, unknown> | undefined;
  if (state.finishReason && usage) {
    const { inputTokens, outputTokens, cachedTokens } = extractTokensFromOpenAIUsage(usage);
    const usageObj: Record<string, unknown> = {
      input_tokens: inputTokens,
      output_tokens: outputTokens,
    };
    if (cachedTokens > 0) usageObj.cache_read_input_tokens = cachedTokens;

    results.push(appendSSEEventBytes(
      new Uint8Array(),
      "message_delta",
      {
        type: "message_delta",
        delta: {
          stop_reason: mapFinishReason(state.finishReason),
          stop_sequence: null,
        },
        usage: usageObj,
      },
      2
    ));
    state.messageDeltaSent = true;
    emitMessageStop(state, results);
  }

  return results;
}

/**
 * Convert a non-streaming OpenAI response to Anthropic format.
 */
export function convertOpenAIResponseToClaudeNonStream(
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

  const out: Record<string, unknown> = {
    id: parsed.id ?? "",
    type: "message",
    role: "assistant",
    model: parsed.model ?? "",
    content: [],
    stop_reason: null,
    stop_sequence: null,
    usage: { input_tokens: 0, output_tokens: 0 },
  };

  const choice = (parsed.choices as Array<Record<string, unknown>> | undefined)?.[0];
  if (!choice) return raw;

  // finish_reason
  const finishReason = choice.finish_reason as string | undefined;
  out.stop_reason = mapFinishReason(finishReason ?? "");

  const message = choice.message as Record<string, unknown> | undefined;
  if (message) {
    // reasoning_content → thinking blocks
    const reasoning = message.reasoning_content;
    if (reasoning) {
      for (const text of collectReasoningTexts(reasoning)) {
        if (text) (out.content as unknown[]).push({ type: "thinking", thinking: text });
      }
    }

    // content → text blocks
    const content = message.content;
    if (typeof content === "string" && content) {
      (out.content as unknown[]).push({ type: "text", text: content });
    } else if (Array.isArray(content)) {
      for (const item of content) {
        if (item && typeof item === "object") {
          const obj = item as Record<string, unknown>;
          const itemType = obj.type as string;
          if (itemType === "text") {
            const text = obj.text as string | undefined;
            if (text) (out.content as unknown[]).push({ type: "text", text });
          } else if (itemType === "tool_calls") {
            const calls = obj.tool_calls as Array<Record<string, unknown>> | undefined;
            if (Array.isArray(calls)) {
              for (const tc of calls) {
                const fn = tc.function as Record<string, unknown>;
                const argsRaw = fn?.arguments as string | undefined;
                let input: Record<string, unknown> = {};
                if (argsRaw) {
                  try { input = JSON.parse(argsRaw); } catch { /* ignore */ }
                }
                (out.content as unknown[]).push({
                  type: "tool_use",
                  id: sanitizeClaudeToolID(tc.id as string ?? ""),
                  name: fn?.name ?? "",
                  input,
                });
              }
            }
          } else if (itemType === "reasoning") {
            const text = obj.text as string | undefined;
            if (text) (out.content as unknown[]).push({ type: "thinking", thinking: text });
          }
        }
      }
    }

    // tool_calls (raw OpenAI format) → tool_use blocks
    const rawToolCalls = message.tool_calls as Array<Record<string, unknown>> | undefined;
    if (Array.isArray(rawToolCalls)) {
      for (const tc of rawToolCalls) {
        const fn = tc.function as Record<string, unknown>;
        const argsRaw = fn?.arguments as string | undefined;
        let input: Record<string, unknown> = {};
        if (argsRaw) {
          try { input = JSON.parse(argsRaw); } catch { /* ignore */ }
        }
        (out.content as unknown[]).push({
          type: "tool_use",
          id: sanitizeClaudeToolID(tc.id as string ?? ""),
          name: fn?.name ?? "",
          input,
        });
      }
    }
  }

  // usage
  const usage = parsed.usage as Record<string, unknown> | undefined;
  if (usage) {
    const { inputTokens, outputTokens, cachedTokens } = extractTokensFromOpenAIUsage(usage);
    (out.usage as Record<string, unknown>).input_tokens = inputTokens;
    (out.usage as Record<string, unknown>).output_tokens = outputTokens;
    if (cachedTokens > 0) {
      (out.usage as Record<string, unknown>).cache_read_input_tokens = cachedTokens;
    }
  }

  return new TextEncoder().encode(JSON.stringify(out));
}

// ─── Helpers ───────────────────────────────────────────────────────────────────

function collectReasoningTexts(node: unknown): string[] {
  const result: string[] = [];
  if (!node) return result;

  if (typeof node === "string") {
    if (node.trim()) result.push(node.trim());
    return result;
  }

  if (Array.isArray(node)) {
    for (const item of node) {
      result.push(...collectReasoningTexts(item));
    }
    return result;
  }

  if (typeof node === "object" && node) {
    const obj = node as Record<string, unknown>;
    if (obj.text) {
      const text = obj.text as string;
      if (text.trim()) result.push(text.trim());
    } else if (obj.reasoning_content) {
      result.push(...collectReasoningTexts(obj.reasoning_content));
    }
  }

  return result;
}

function mapFinishReason(reason: string): string {
  switch (reason) {
    case "stop":           return "end_turn";
    case "length":         return "max_tokens";
    case "tool_calls":      return "tool_use";
    case "content_filter":  return "end_turn";
    case "function_call":   return "tool_use";
    default:               return "end_turn";
  }
}

function stopThinkingBlock(state: StreamingState, results: Uint8Array[]): void {
  if (!state.thinkingBlockStarted) return;
  results.push(appendSSEEventBytes(
    new Uint8Array(),
    "content_block_stop",
    { type: "content_block_stop", index: state.thinkingBlockIndex },
    2
  ));
  state.thinkingBlockStarted = false;
  state.thinkingBlockIndex = -1;
}

function stopTextBlock(state: StreamingState, results: Uint8Array[]): void {
  if (!state.textBlockStarted) return;
  results.push(appendSSEEventBytes(
    new Uint8Array(),
    "content_block_stop",
    { type: "content_block_stop", index: state.textBlockIndex },
    2
  ));
  state.textBlockStarted = false;
  state.textBlockIndex = -1;
}

function emitMessageStop(state: StreamingState, results: Uint8Array[]): void {
  if (state.messageStopSent) return;
  results.push(appendSSEEventBytes(
    new Uint8Array(),
    "message_stop",
    { type: "message_stop" },
    2
  ));
  state.messageStopSent = true;
}

function buildDoneEvents(state: StreamingState): Uint8Array[] {
  const results: Uint8Array[] = [];

  // Stop thinking
  if (state.thinkingBlockStarted) {
    results.push(appendSSEEventBytes(
      new Uint8Array(),
      "content_block_stop",
      { type: "content_block_stop", index: state.thinkingBlockIndex },
      2
    ));
  }

  // Stop text
  if (state.textBlockStarted) {
    results.push(appendSSEEventBytes(
      new Uint8Array(),
      "content_block_stop",
      { type: "content_block_stop", index: state.textBlockIndex },
      2
    ));
  }

  // Stop all tool calls
  if (!state.contentBlocksStopped) {
    for (const [index, accum] of state.toolCalls) {
      const blockIndex = state.toolBlockIndexes.get(index);
      if (blockIndex === undefined || state.toolBlockStopped.get(index)) continue;
      if (accum.arguments) {
        results.push(appendSSEEventBytes(
          new Uint8Array(),
          "content_block_delta",
          {
            type: "content_block_delta",
            index: blockIndex,
            delta: { type: "input_json_delta", partial_json: fixPartialJSON(accum.arguments) },
          },
          2
        ));
      }
      results.push(appendSSEEventBytes(
        new Uint8Array(),
        "content_block_stop",
        { type: "content_block_stop", index: blockIndex },
        2
      ));
    }
  }

  // message_delta if not yet sent
  if (state.finishReason && !state.messageDeltaSent) {
    results.push(appendSSEEventBytes(
      new Uint8Array(),
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: mapFinishReason(state.finishReason), stop_sequence: null },
        usage: { input_tokens: 0, output_tokens: 0 },
      },
      2
    ));
  }

  emitMessageStop(state, results);
  return results;
}

function buildToolNameMap(state: StreamingState, originalRequest: Uint8Array): void {
  if (originalRequest.length === 0) return;
  try {
    const obj = JSON.parse(new TextDecoder().decode(originalRequest));
    if (obj._toolNameMap instanceof Map) {
      state.toolNameMap = obj._toolNameMap;
    } else if (typeof obj._toolNameMap === "object" && obj._toolNameMap !== null) {
      for (const [k, v] of Object.entries(obj._toolNameMap as Record<string, string>)) {
        state.toolNameMap.set(k, v);
      }
    }
  } catch {
    // ignore
  }
}

function mapToolName(toolNameMap: Map<string, string>, name: string): string {
  if (toolNameMap.size === 0) return name;
  for (const [original, translated] of toolNameMap.entries()) {
    if (translated === name) return original;
  }
  return name;
}
