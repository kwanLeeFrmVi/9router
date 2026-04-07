// Translates Claude API format → OpenAI Chat Completions format.
// Written from scratch in TypeScript — not a port of the Go code.

import { convertBudgetToLevel } from "../../thinking/index.ts";

/**
 * Convert an Anthropic API request to OpenAI Chat Completions format.
 */
export function convertClaudeRequestToOpenAI(
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
  };

  // max_tokens
  if (raw.max_tokens !== undefined) {
    out.max_tokens = raw.max_tokens;
  }

  // temperature → temperature; top_p → top_p (as fallback)
  if (raw.temperature !== undefined) {
    out.temperature = raw.temperature;
  } else if (raw.top_p !== undefined) {
    out.top_p = raw.top_p;
  }

  // stop_sequences → stop
  if (Array.isArray(raw.stop_sequences) && raw.stop_sequences.length > 0) {
    out.stop = raw.stop_sequences.length === 1
      ? raw.stop_sequences[0]
      : raw.stop_sequences;
  }

  out.stream = stream;

  // ── Thinking config: Claude budget_tokens → OpenAI reasoning_effort ───────────
  if (raw.thinking && typeof raw.thinking === "object") {
    const thinkingConfig = raw.thinking as Record<string, unknown>;
    const thinkingType = thinkingConfig.type as string | undefined;

    if (thinkingType === "enabled") {
      const budgetTokens = thinkingConfig.budget_tokens as number | undefined;
      const { effort } = budgetTokens !== undefined
        ? convertBudgetToLevel(budgetTokens)
        : convertBudgetToLevel(-1); // default enabled
      if (effort) out.reasoning_effort = effort;
    } else if (thinkingType === "disabled") {
      const { effort } = convertBudgetToLevel(0);
      if (effort) out.reasoning_effort = effort;
    }
    // "auto"/"adaptive" — pass through explicit effort if present
    if (!out.reasoning_effort) {
      const effort = raw.output_config?.effort;
      if (typeof effort === "string" && effort.trim()) {
        out.reasoning_effort = effort.trim().toLowerCase();
      }
    }
  }

  // ── Messages ──────────────────────────────────────────────────────────────────
  const messages: Array<Record<string, unknown>> = [];

  // System message
  const system = raw.system;
  if (system) {
    const systemContent = buildContentArray(system);
    if (systemContent.length > 0) {
      messages.push({ role: "system", content: systemContent });
    }
  }

  // Anthropic messages
  const anthropicMessages = raw.messages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(anthropicMessages)) {
    for (const msg of anthropicMessages) {
      const role: string = msg.role as string;
      const content = msg.content;
      if (!content) continue;

      if (Array.isArray(content)) {
        const { openaiContent, toolResults } = processClaudeContent(content, role);
        // Emit tool results first (they respond to previous assistant tool_calls)
        messages.push(...toolResults);
        if (openaiContent) {
          messages.push({ role, content: openaiContent });
        }
      } else if (typeof content === "string" && content) {
        messages.push({ role, content });
      }
    }
  }

  if (messages.length > 0) {
    out.messages = messages;
  }

  // ── Tools: Anthropic tools → OpenAI functions ─────────────────────────────────
  const tools = raw.tools as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tools) && tools.length > 0) {
    out.tools = tools.map(tool => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description ?? "",
        parameters: (tool as Record<string, unknown>).input_schema ?? {},
      },
    }));
  }

  // ── Tool choice mapping ────────────────────────────────────────────────────────
  const toolChoice = raw.tool_choice as Record<string, unknown> | undefined;
  if (toolChoice) {
    const choiceType = toolChoice.type as string;
    if (choiceType === "auto")      out.tool_choice = "auto";
    else if (choiceType === "any")  out.tool_choice = "required";
    else if (choiceType === "tool") {
      const name = toolChoice.name as string | undefined;
      if (name) out.tool_choice = { type: "function", function: { name } };
    }
  }

  // ── user field ────────────────────────────────────────────────────────────────
  if (raw.user !== undefined) {
    out.user = raw.user;
  }

  return new TextEncoder().encode(JSON.stringify(out));
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function buildContentArray(system: unknown): Array<Record<string, unknown>> {
  if (typeof system === "string" && system.trim()) {
    return [{ type: "text", text: system.trim() }];
  }
  if (Array.isArray(system)) {
    return system
      .map(part => convertClaudeContentPart(part as Record<string, unknown>))
      .filter(Boolean) as Array<Record<string, unknown>>;
  }
  return [];
}

interface ProcessResult {
  openaiContent: Array<Record<string, unknown>> | null;
  toolResults: Array<Record<string, unknown>>;
}

function processClaudeContent(
  content: Array<Record<string, unknown>>,
  role: string
): ProcessResult {
  const openaiContent: Array<Record<string, unknown>> = [];
  const toolResults: Array<Record<string, unknown>> = [];
  const reasoningTexts: string[] = [];
  const toolCalls: Array<Record<string, unknown>> = [];

  for (const part of content) {
    const partType = part.type as string;
    switch (partType) {
      case "text":
      case "image": {
        const converted = convertClaudeContentPart(part);
        if (converted) openaiContent.push(converted);
        break;
      }
      case "thinking": {
        if (role === "assistant") {
          const text = (part.thinking as string | undefined)?.trim();
          if (text) reasoningTexts.push(text);
        }
        break;
      }
      case "redacted_thinking": {
        // Skip — never map to reasoning_content
        break;
      }
      case "tool_use": {
        if (role === "assistant") {
          const call: Record<string, unknown> = {
            id: part.id ?? "",
            type: "function",
            function: {
              name: part.name ?? "",
              arguments: (part.input as string | undefined) ?? "{}",
            },
          };
          toolCalls.push(call);
        }
        break;
      }
      case "tool_result": {
        const toolCallId = (part.tool_use_id as string | undefined) ?? "";
        const { content: text, isRaw } = extractToolResultContent(part.content);
        if (isRaw) {
          toolResults.push({ role: "tool", tool_call_id: toolCallId, content: text });
        } else {
          toolResults.push({ role: "tool", tool_call_id: toolCallId, content: text });
        }
        break;
      }
    }
  }

  const hasReasoning = reasoningTexts.length > 0;
  const hasToolCalls = toolCalls.length > 0;

  // Build reasoning_content if present
  if (hasReasoning) {
    (openaiContent[openaiContent.length - 1] as Record<string, unknown> | undefined)
      && Object.defineProperty(openaiContent[openaiContent.length - 1] as Record<string, unknown>, "reasoning_content", {
        value: reasoningTexts.join("\n\n"),
        writable: true,
        enumerable: true,
      });
  }

  // Build content + tool_calls in one message for assistant
  if (role === "assistant" && (openaiContent.length > 0 || hasToolCalls)) {
    const msg: Record<string, unknown> = {
      role: "assistant",
      content: openaiContent.length > 0 ? openaiContent : "",
    };
    if (hasToolCalls) msg.tool_calls = toolCalls;
    return { openaiContent: [msg], toolResults };
  }

  return { openaiContent: openaiContent.length > 0 ? openaiContent : null, toolResults };
}

function convertClaudeContentPart(
  part: Record<string, unknown>
): Record<string, unknown> | null {
  const partType = part.type as string;

  if (partType === "text") {
    const text = (part.text as string | undefined)?.trim();
    if (!text) return null;
    return { type: "text", text };
  }

  if (partType === "image") {
    const imageURL = extractImageURL(part);
    if (!imageURL) return null;
    return { type: "image_url", image_url: { url: imageURL } };
  }

  return null;
}

function extractImageURL(part: Record<string, unknown>): string {
  const source = part.source as Record<string, unknown> | undefined;
  if (source) {
    const sourceType = source.type as string;
    if (sourceType === "base64") {
      const mediaType = (source.media_type as string | undefined) ?? "application/octet-stream";
      const data = source.data as string | undefined;
      return data ? `data:${mediaType};base64,${data}` : "";
    }
    if (sourceType === "url") {
      return (source.url as string | undefined) ?? "";
    }
  }
  return (part.url as string | undefined) ?? "";
}

function extractToolResultContent(
  content: unknown
): { content: string; isRaw: boolean } {
  if (!content) return { content: "", isRaw: false };

  if (typeof content === "string") {
    return { content, isRaw: false };
  }

  if (Array.isArray(content)) {
    const parts: string[] = [];
    let hasNonString = false;

    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
      } else if (typeof item === "object" && item) {
        const obj = item as Record<string, unknown>;
        if (obj.type === "text") {
          const text = obj.text as string | undefined;
          if (text) parts.push(text);
        } else if (obj.type === "image") {
          hasNonString = true;
        } else {
          const text = obj.text as string | undefined;
          if (text) parts.push(text);
          else parts.push(JSON.stringify(obj));
        }
      }
    }

    const joined = parts.join("\n\n").trim();
    return { content: joined || JSON.stringify(content), isRaw: hasNonString };
  }

  if (typeof content === "object" && content) {
    const obj = content as Record<string, unknown>;
    if (obj.type === "image") {
      const converted = convertClaudeContentPart(obj);
      if (converted) return { content: JSON.stringify([converted]), isRaw: true };
    }
    const text = obj.text as string | undefined;
    return { content: text ?? JSON.stringify(content), isRaw: false };
  }

  return { content: String(content), isRaw: false };
}
