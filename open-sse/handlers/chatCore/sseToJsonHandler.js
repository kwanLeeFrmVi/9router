import { convertResponsesStreamToJson } from "../../transformer/streamToJsonConverter.js";
import { createErrorResult } from "../../utils/error.js";
import { HTTP_STATUS } from "../../config/runtimeConfig.js";
import { FORMATS } from "../../translator/formats.js";
import { buildRequestDetail, extractRequestConfig, saveUsageStats } from "./requestDetail.js";
import { saveRequestDetail, appendRequestLog } from "@/lib/usageDb.js";

// Use string constants to avoid SWC regex parsing issues with special chars
const T1 = "<" + "think" + ">"; // <think>
const T2 = "<" + "/" + "think" + ">"; // </think>
const T2N = T2 + "\n\n"; // </think>\n\n

/**
 * Strip thinking tags from text content.
 * Some providers send thinking delimiters as text rather than as separate reasoning_content events.
 */
function stripThinkingTags(text) {
  if (!text) return text;
  text = text.split(T1).join("");
  text = text.split(T2).join("");
  text = text.split(T2N).join("");
  // Clean up any leftover whitespace from stripped tags
  if (text.trim() !== text) text = text.trim();
  return text;
}

function textFromResponsesMessageItem(item) {
  if (!item?.content || !Array.isArray(item.content)) return "";
  const byType = item.content.find((c) => c.type === "output_text");
  if (typeof byType?.text === "string") return byType.text;
  const anyText = item.content.find((c) => typeof c.text === "string");
  if (typeof anyText?.text === "string") return anyText.text;
  return "";
}

/**
 * Codex / Responses API may emit many alternating reasoning + message items.
 * Early message blocks often have empty output_text; the user-visible answer is usually in the last non-empty message.
 */
function pickAssistantMessageForChatCompletion(output) {
  if (!Array.isArray(output)) return { msgItem: null, textContent: null };
  const messages = output.filter((item) => item?.type === "message");
  if (messages.length === 0) return { msgItem: null, textContent: null };
  for (let i = messages.length - 1; i >= 0; i--) {
    const text = textFromResponsesMessageItem(messages[i]);
    if (text.length > 0) return { msgItem: messages[i], textContent: text };
  }
  const last = messages[messages.length - 1];
  return { msgItem: last, textContent: textFromResponsesMessageItem(last) };
}

/**
 * Parse OpenAI-style SSE text into a single chat completion JSON.
 * Used when provider forces streaming but client wants non-streaming.
 */
export function parseSSEToOpenAIResponse(rawSSE, fallbackModel) {
  const chunks = [];

  for (const line of String(rawSSE || "").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("data:")) continue;
    const payload = trimmed.slice(5).trim();
    if (!payload || payload === "[DONE]") continue;
    try { chunks.push(JSON.parse(payload)); } catch { /* ignore malformed lines */ }
  }

  if (chunks.length === 0) return null;

  const first = chunks[0];
  const contentParts = [];
  const reasoningParts = [];
  const toolCallMap = new Map(); // index -> { id, type, function: { name, arguments } }
  let finishReason = "stop";
  let usage = null;

  for (const chunk of chunks) {
    const choice = chunk?.choices?.[0];
    const delta = choice?.delta || {};
    if (typeof delta.content === "string" && delta.content.length > 0) {
      // Strip thinking tags from content (some providers send them as text)
      const stripped = stripThinkingTags(delta.content);
      if (stripped) contentParts.push(stripped);
    }
    if (typeof delta.reasoning_content === "string" && delta.reasoning_content.length > 0) reasoningParts.push(delta.reasoning_content);
    if (choice?.finish_reason) finishReason = choice.finish_reason;
    if (chunk?.usage && typeof chunk.usage === "object") usage = chunk.usage;

    // Accumulate tool_calls from streaming deltas
    if (Array.isArray(delta.tool_calls)) {
      for (const tc of delta.tool_calls) {
        const idx = tc.index ?? 0;
        if (!toolCallMap.has(idx)) {
          toolCallMap.set(idx, { id: tc.id || "", type: "function", function: { name: "", arguments: "" } });
        }
        const existing = toolCallMap.get(idx);
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.function.name += tc.function.name;
        if (tc.function?.arguments) existing.function.arguments += tc.function.arguments;
      }
    }
  }

  const message = { role: "assistant", content: contentParts.join("") || (toolCallMap.size > 0 ? null : "") };
  if (reasoningParts.length > 0) message.reasoning_content = reasoningParts.join("");
  if (toolCallMap.size > 0) {
    message.tool_calls = [...toolCallMap.entries()].sort((a, b) => a[0] - b[0]).map(([, tc]) => tc);
  }

  const result = {
    id: first.id || `chatcmpl-${Date.now()}`,
    object: "chat.completion",
    created: first.created || Math.floor(Date.now() / 1000),
    model: first.model || fallbackModel || "unknown",
    choices: [{ index: 0, message, finish_reason: finishReason }]
  };
  if (usage) result.usage = usage;
  return result;
}

/**
 * Handle case: provider forced streaming but client wants JSON.
 * Supports both Codex/Responses API SSE and standard Chat Completions SSE.
 */
export async function handleForcedSSEToJson({ providerResponse, sourceFormat, provider, model, body, stream, translatedBody, finalBody, requestStartTime, connectionId, apiKey, clientRawRequest, onRequestSuccess, trackDone, appendLog }) {
  const contentType = providerResponse.headers.get("content-type") || "";
  const isSSE = contentType.includes("text/event-stream") || (contentType === "" && provider === "codex");
  if (!isSSE) return null; // not handled here

  trackDone();

  const ctx = {
    provider, model, connectionId,
    request: extractRequestConfig(body, stream),
    providerRequest: finalBody || translatedBody || null
  };

  // Codex/Responses API SSE path
  const isCodexResponsesApi = provider === "codex" || sourceFormat === FORMATS.OPENAI_RESPONSES;
  if (isCodexResponsesApi) {
    try {
      const jsonResponse = await convertResponsesStreamToJson(providerResponse.body);
      if (onRequestSuccess) await onRequestSuccess();

      const usage = jsonResponse.usage || {};
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint });

      const { textContent } = pickAssistantMessageForChatCompletion(jsonResponse.output);
      const totalLatency = Date.now() - requestStartTime;

      saveRequestDetail(buildRequestDetail({
        ...ctx,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: { prompt_tokens: usage.input_tokens || 0, completion_tokens: usage.output_tokens || 0 },
        response: { content: textContent, thinking: null, finish_reason: jsonResponse.status || "unknown" },
        status: "success"
      }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

      // Client is Responses API -> return as-is
      if (sourceFormat === FORMATS.OPENAI_RESPONSES) {
        return { success: true, response: new Response(JSON.stringify(jsonResponse), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      }

      // Build client-format response
      const inTokens = usage.input_tokens || 0;
      const outTokens = usage.output_tokens || 0;

      // Extract tool calls from Responses API output (function_call items)
      const funcCallItems = (jsonResponse.output || []).filter(item => item.type === "function_call");
      const toolCalls = funcCallItems.map((item, idx) => ({
        id: item.call_id || `call_${item.name}_${Date.now()}_${idx}`,
        type: "function",
        function: {
          name: item.name,
          arguments: typeof item.arguments === "string" ? item.arguments : JSON.stringify(item.arguments || {})
        }
      }));
      const hasToolCalls = toolCalls.length > 0;

      if (sourceFormat === FORMATS.ANTIGRAVITY || sourceFormat === FORMATS.GEMINI || sourceFormat === FORMATS.GEMINI_CLI) {
        const finalResp = {
          response: {
            candidates: [{ content: { role: "model", parts: [{ text: textContent || "" }] }, finishReason: "STOP", index: 0 }],
            usageMetadata: { promptTokenCount: inTokens, candidatesTokenCount: outTokens, totalTokenCount: inTokens + outTokens },
            modelVersion: model,
            responseId: jsonResponse.id || `resp_${Date.now()}`
          }
        };
        return { success: true, response: new Response(JSON.stringify(finalResp), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
      }

      const message = { role: "assistant", content: textContent || (hasToolCalls ? null : "") };
      if (hasToolCalls) message.tool_calls = toolCalls;
      const finish_reason = hasToolCalls ? "tool_calls" : (jsonResponse.status === "completed" ? "stop" : (jsonResponse.status || "stop"));
      const finalResp = {
        id: jsonResponse.id || `chatcmpl-${Date.now()}`,
        object: "chat.completion",
        created: jsonResponse.created_at || Math.floor(Date.now() / 1000),
        model: jsonResponse.model || model,
        choices: [{ index: 0, message, finish_reason }],
        usage: { prompt_tokens: inTokens, completion_tokens: outTokens, total_tokens: inTokens + outTokens }
      };
      return { success: true, response: new Response(JSON.stringify(finalResp), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    } catch (err) {
      console.error("[ChatCore] Responses API SSE->JSON failed:", err);
      return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
    }
  }

  // Standard Chat Completions SSE path
  try {
    const sseText = await providerResponse.text();

    // Claude SSE -> JSON conversion
    if (sourceFormat === FORMATS.CLAUDE) {
      const parsed = parseClaudeSSEToJSON(sseText, model);
      if (!parsed) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid Claude SSE response for non-streaming request");

      if (onRequestSuccess) await onRequestSuccess();

      const usage = parsed.usage || {};
      appendLog({ tokens: usage, status: "200 OK" });
      saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint });

      const totalLatency = Date.now() - requestStartTime;
      saveRequestDetail(buildRequestDetail({
        ...ctx,
        latency: { ttft: totalLatency, total: totalLatency },
        tokens: usage,
        response: {
          content: parsed.choices?.[0]?.message?.content || null,
          thinking: parsed.choices?.[0]?.message?.reasoning_content || null,
          finish_reason: parsed.choices?.[0]?.finish_reason || "unknown"
        },
        status: "success"
      }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

      return { success: true, response: new Response(JSON.stringify(parsed), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
    }

    const parsed = parseSSEToOpenAIResponse(sseText, model);
    if (!parsed) return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Invalid SSE response for non-streaming request");

    if (onRequestSuccess) await onRequestSuccess();

    const usage = parsed.usage || {};
    appendLog({ tokens: usage, status: "200 OK" });
    saveUsageStats({ provider, model, tokens: usage, connectionId, apiKey, endpoint: clientRawRequest?.endpoint });

    const totalLatency = Date.now() - requestStartTime;
    saveRequestDetail(buildRequestDetail({
      ...ctx,
      latency: { ttft: totalLatency, total: totalLatency },
      tokens: usage,
      response: {
        content: parsed.choices?.[0]?.message?.content || null,
        thinking: parsed.choices?.[0]?.message?.reasoning_content || null,
        finish_reason: parsed.choices?.[0]?.finish_reason || "unknown"
      },
      status: "success"
    }, { endpoint: clientRawRequest?.endpoint || null })).catch(() => {});

    return { success: true, response: new Response(JSON.stringify(parsed), { headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" } }) };
  } catch (err) {
    console.error("[ChatCore] Chat Completions SSE->JSON failed:", err);
    return createErrorResult(HTTP_STATUS.BAD_GATEWAY, "Failed to convert streaming response to JSON");
  }
}

/**
 * Parse Claude SSE stream into a JSON response for non-streaming clients.
 * Handles both streaming SSE and non-streaming JSON (wrapped in "data: " prefix).
 */
function parseClaudeSSEToJSON(rawSSE, fallbackModel) {
  const raw = (rawSSE || "").trim();
  // Strip trailing "data: [DONE]"
  const withoutDone = raw.replace(/\n?data:\s*\[DONE\]\s*$/g, "");
  // Strip leading "data: " prefix to get the JSON body
  const jsonStr = withoutDone.replace(/^data:\s*/, "").trim();

  let messageId = null;
  let stopReason = "stop";
  let usage = null;
  const textParts = [];
  const thinkingParts = [];
  const toolCalls = [];

  // Try to parse as a single JSON (non-streaming Claude response)
  let singleResponse = null;
  try {
    singleResponse = JSON.parse(jsonStr);
  } catch { /* not single JSON, treat as SSE */ }

  if (singleResponse && singleResponse.type === "message") {
    // Non-streaming Claude response
    messageId = singleResponse.id || `msg_${Date.now()}`;
    stopReason = convertClaudeStopReason(singleResponse.stop_reason || "end_turn");
    if (singleResponse.usage) {
      const u = singleResponse.usage;
      usage = {
        prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        completion_tokens: u.output_tokens || 0,
        total_tokens: ((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)) + (u.output_tokens || 0),
        input_tokens: u.input_tokens || 0,
        output_tokens: u.output_tokens || 0
      };
    }
    if (Array.isArray(singleResponse.content)) {
      for (const block of singleResponse.content) {
        if (block.type === "text" && block.text) textParts.push(block.text);
        else if (block.type === "thinking" && block.thinking) thinkingParts.push(block.thinking);
        else if (block.type === "tool_use") {
          toolCalls.push({ id: block.id, type: "function", function: { name: block.name, arguments: JSON.stringify(block.input || {}) } });
        }
      }
    }
  } else {
    // Streaming SSE
    for (const line of String(rawSSE || "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;

      let chunk;
      try { chunk = JSON.parse(payload); } catch { continue; }
      if (!chunk) continue;

      const event = chunk.type;

      if (event === "message_start") {
        messageId = chunk.message?.id || null;
      } else if (event === "content_block_delta") {
        const delta = chunk.delta;
        if (delta?.type === "text_delta" && delta.text) {
          const stripped = stripThinkingTags(delta.text);
          if (stripped) textParts.push(stripped);
        } else if (delta?.type === "thinking_delta" && delta.thinking) {
          thinkingParts.push(delta.thinking);
        }
      } else if (event === "message_delta") {
        if (chunk.delta?.stop_reason) {
          stopReason = convertClaudeStopReason(chunk.delta.stop_reason);
        }
        if (chunk.usage) {
          const u = chunk.usage;
          usage = {
            prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
            completion_tokens: u.output_tokens || 0,
            total_tokens: ((u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0)) + (u.output_tokens || 0),
            input_tokens: u.input_tokens || 0,
            output_tokens: u.output_tokens || 0
          };
        }
      }
    }
  }

  if (!messageId) return null;

  const message = { role: "assistant" };
  const content = textParts.join("");
  if (content) message.content = content;
  if (thinkingParts.length > 0) message.reasoning_content = thinkingParts.join("");
  if (toolCalls.length > 0) {
    message.tool_calls = toolCalls;
    if (stopReason === "stop") stopReason = "tool_calls";
  }

  return {
    id: `chatcmpl-${messageId}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: fallbackModel || "claude",
    choices: [{ index: 0, message, finish_reason: stopReason }],
    ...(usage ? { usage } : {})
  };
}

function convertClaudeStopReason(reason) {
  switch (reason) {
    case "end_turn": return "stop";
    case "max_tokens": return "length";
    case "tool_use": return "tool_calls";
    case "stop_sequence": return "stop";
    default: return "stop";
  }
}
