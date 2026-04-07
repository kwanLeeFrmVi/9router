// Translates OpenAI Chat Completions format → Anthropic API format.
// Written from scratch in TypeScript.

import { levelToBudget } from "../../thinking/index.ts";

/**
 * Convert an OpenAI Chat Completions request to Anthropic API format.
 */
export function convertOpenAIRequestToClaude(
  modelName: string,
  inputRaw: Uint8Array
): Uint8Array {
  const raw = typeof inputRaw === "string"
    ? JSON.parse(inputRaw)
    : JSON.parse(new TextDecoder().decode(inputRaw));

  const out: Record<string, unknown> = {
    model: modelName,
    max_tokens: raw.max_tokens ?? 4096,
  };

  // temperature
  if (raw.temperature !== undefined) {
    out.temperature = raw.temperature;
  }

  // top_p
  if (raw.top_p !== undefined) {
    out.top_p = raw.top_p;
  }

  // stop sequences
  if (raw.stop !== undefined) {
    out.stop_sequences = Array.isArray(raw.stop) ? raw.stop : [raw.stop];
  }

  // stream (passthrough)
  out.stream = raw.stream ?? false;

  // ── reasoning_effort → thinking budget ───────────────────────────────────────
  const reasoningEffort = raw.reasoning_effort as string | undefined;
  if (reasoningEffort) {
    const budget = levelToBudget(reasoningEffort);
    if (budget !== null) {
      out.thinking = {
        type: budget === 0 ? "disabled" : "enabled",
        budget_tokens: budget,
      };
    }
  }

  // ── Messages ──────────────────────────────────────────────────────────────────
  const messages: Array<Record<string, unknown>> = [];

  // System message
  const systemContent = extractSystemMessage(raw);
  if (systemContent) {
    out.system = systemContent;
  }

  // User/assistant/tool messages
  const rawMessages = raw.messages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(rawMessages)) {
    for (const msg of rawMessages) {
      const role = msg.role as string;
      const content = msg.content;

      if (role === "system") {
        // Already handled above, skip
        continue;
      }

      if (role === "tool") {
        // OpenAI tool result → Claude tool_result
        const toolCallId = msg.tool_call_id as string | undefined;
        const contentStr = typeof content === "string" ? content : JSON.stringify(content);
        messages.push({
          role: "tool",
          content: [
            {
              type: "tool_result",
              tool_use_id: toolCallId ?? "",
              content: contentStr,
            },
          ],
        });
        continue;
      }

      // Regular user or assistant message
      const claudeContent = convertOpenAIMessageContent(content, msg.tool_calls as Array<Record<string, unknown>> | undefined);
      if (claudeContent) {
        messages.push({ role, content: claudeContent });
      }
    }
  }

  if (messages.length > 0) {
    out.messages = messages;
  }

  // ── Tools: OpenAI functions → Anthropic tools ─────────────────────────────────
  const tools = raw.tools as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tools) && tools.length > 0) {
    out.tools = tools.map(tool => {
      const fn = tool.function as Record<string, unknown> | undefined;
      return {
        name: fn?.name ?? "",
        description: fn?.description ?? "",
        input_schema: fn?.parameters ?? {},
      };
    });
  }

  // ── Tool choice mapping ───────────────────────────────────────────────────────
  const toolChoice = raw.tool_choice as Record<string, unknown> | string | undefined;
  if (toolChoice) {
    if (toolChoice === "auto") {
      out.tool_choice = { type: "auto" };
    } else if (toolChoice === "required") {
      out.tool_choice = { type: "any" };
    } else if (typeof toolChoice === "object") {
      const choiceObj = toolChoice as Record<string, unknown>;
      const choiceType = choiceObj.type as string | undefined;
      if (choiceType === "function") {
        const fn = choiceObj.function as Record<string, unknown> | undefined;
        out.tool_choice = { type: "tool", name: fn?.name ?? "" };
      } else if (choiceType === "auto") {
        out.tool_choice = { type: "auto" };
      } else if (choiceType === "required") {
        out.tool_choice = { type: "any" };
      }
    }
  }

  // ── user field ────────────────────────────────────────────────────────────────
  if (raw.user !== undefined) {
    out.user = raw.user;
  }

  // ── Extra passthrough fields ──────────────────────────────────────────────────
  if (raw.metadata !== undefined) {
    out.metadata = raw.metadata;
  }

  return new TextEncoder().encode(JSON.stringify(out));
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function extractSystemMessage(raw: Record<string, unknown>): unknown {
  const messages = raw.messages as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(messages)) return null;

  for (const msg of messages) {
    if ((msg.role as string) === "system") {
      return convertOpenAIContentToClaude(msg.content);
    }
  }
  return null;
}

function convertOpenAIMessageContent(
  content: unknown,
  toolCalls: Array<Record<string, unknown>> | undefined
): Array<Record<string, unknown>> | string | null {
  const parts: Array<Record<string, unknown>> = [];
  let hasToolCalls = false;

  // Handle string content
  if (typeof content === "string" && content.trim()) {
    parts.push({ type: "text", text: content.trim() });
  }

  // Handle array content
  if (Array.isArray(content)) {
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const itemType = obj.type as string;

      if (itemType === "text") {
        const text = obj.text as string | undefined;
        if (text?.trim()) parts.push({ type: "text", text: text.trim() });
      } else if (itemType === "image_url") {
        const imageUrl = obj.image_url as Record<string, unknown> | undefined;
        if (imageUrl) {
          const url = imageUrl.url as string | undefined;
          if (url) {
            if (url.startsWith("data:")) {
              // Parse data URL
              const { mediaType, data } = parseDataURL(url);
              parts.push({
                type: "image",
                source: {
                  type: "base64",
                  media_type: mediaType,
                  data,
                },
              });
            } else {
              parts.push({ type: "image", source: { type: "url", url } });
            }
          }
        }
      }
    }
  }

  // Handle tool calls (assistant messages)
  if (Array.isArray(toolCalls)) {
    hasToolCalls = true;
    for (const tc of toolCalls) {
      const fn = tc.function as Record<string, unknown> | undefined;
      const args = fn?.arguments;
      let inputStr: string;
      if (typeof args === "string") {
        inputStr = args;
      } else if (typeof args === "object" && args !== null) {
        inputStr = JSON.stringify(args);
      } else {
        inputStr = "{}";
      }

      parts.push({
        type: "tool_use",
        id: (tc.id as string | undefined) ?? "",
        name: fn?.name ?? "",
        input: inputStr,
      });
    }
  }

  if (parts.length === 0 && !hasToolCalls) return null;

  // If only tool calls, return them directly
  if (parts.length > 0 && parts.every(p => p.type === "tool_use")) {
    return parts;
  }

  return parts;
}

function convertOpenAIContentToClaude(content: unknown): unknown {
  if (typeof content === "string") return content.trim() || null;
  if (Array.isArray(content)) {
    const parts: Array<Record<string, unknown>> = [];
    for (const item of content) {
      if (!item || typeof item !== "object") continue;
      const obj = item as Record<string, unknown>;
      const itemType = obj.type as string;
      if (itemType === "text") {
        const text = obj.text as string | undefined;
        if (text?.trim()) parts.push({ type: "text", text: text.trim() });
      } else if (itemType === "image_url") {
        const imageUrl = obj.image_url as Record<string, unknown> | undefined;
        if (imageUrl) {
          const url = imageUrl.url as string | undefined;
          if (url) {
            if (url.startsWith("data:")) {
              const { mediaType, data } = parseDataURL(url);
              parts.push({
                type: "image",
                source: { type: "base64", media_type: mediaType, data },
              });
            } else {
              parts.push({ type: "image", source: { type: "url", url } });
            }
          }
        }
      }
    }
    return parts.length > 0 ? parts : null;
  }
  return null;
}

function parseDataURL(url: string): { mediaType: string; data: string } {
  const match = url.match(/^data:([^;]+);base64,(.+)$/);
  if (match) {
    return { mediaType: match[1] ?? "image/jpeg", data: match[2] ?? "" };
  }
  return { mediaType: "application/octet-stream", data: "" };
}
