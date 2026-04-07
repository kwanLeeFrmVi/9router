// Translates Anthropic API → Ollama format (OpenAI-compatible)
import { levelToBudget } from "../../thinking/index.ts";

export function convertClaudeRequestToOllama(
  modelName: string,
  inputRaw: Uint8Array,
  stream: boolean
): Uint8Array {
  // Parse raw
  const raw = typeof inputRaw === "string" ? JSON.parse(inputRaw) : JSON.parse(new TextDecoder().decode(inputRaw));
  const out: Record<string, unknown> = { model: modelName, stream };

  // max_tokens → keep_alive (or just omit)
  if (raw.max_tokens !== undefined) {
    out.options = out.options || {};
    (out.options as Record<string, unknown>).num_predict = raw.max_tokens;
  }

  // temperature
  if (raw.temperature !== undefined) {
    out.options = out.options || {};
    (out.options as Record<string, unknown>).temperature = raw.temperature;
  }

  // stop_sequences → stop
  if (Array.isArray(raw.stop_sequences) && raw.stop_sequences.length > 0) {
    out.stop = raw.stop_sequences.length === 1 ? raw.stop_sequences[0] : raw.stop_sequences;
  }

  // thinking → skip (Ollama doesn't have thinking)

  // Messages: text/image/tool_result → same structure as OpenAI
  const messages: Array<Record<string, unknown>> = [];

  // System
  const system = raw.system;
  if (system) {
    const systemContent = typeof system === "string" ? system.trim() : JSON.stringify(system);
    if (systemContent) messages.push({ role: "system", content: systemContent });
  }

  const anthropicMessages = raw.messages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(anthropicMessages)) {
    for (const msg of anthropicMessages) {
      const role = msg.role as string;
      const content = msg.content;
      if (!content) continue;

      if (Array.isArray(content)) {
        // Convert content parts
        const parts: string[] = [];
        for (const part of content) {
          const partType = part.type as string;
          if (partType === "text") {
            const text = part.text as string | undefined;
            if (text) parts.push(text);
          } else if (partType === "image") {
            // Ollama may support images
            const source = part.source as Record<string, unknown> | undefined;
            if (source?.type === "base64") {
              const data = source.data as string | undefined;
              const mediaType = (source.media_type as string | undefined) ?? "image/jpeg";
              parts.push(`[image: data:${mediaType};base64,${data}]`);
            }
          } else if (partType === "tool_result") {
            const toolContent = part.content;
            const text = typeof toolContent === "string" ? toolContent : JSON.stringify(toolContent);
            parts.push(`[TOOL_RESULT: ${text}]`);
          } else if (partType === "tool_use") {
            const toolInput = part.input;
            const text = typeof toolInput === "string" ? toolInput : JSON.stringify(toolInput);
            parts.push(`[TOOL_CALL ${part.name}: ${text}]`);
          }
        }
        if (parts.length > 0) messages.push({ role, content: parts.join("\n") });
      } else if (typeof content === "string" && content) {
        messages.push({ role, content });
      }
    }
  }

  if (messages.length > 0) out.messages = messages;

  // Ollama doesn't support tools in the same way — embed as instructions in system
  const tools = raw.tools as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(tools) && tools.length > 0) {
    // Convert tools to a text description appended to system
    const toolDescs = tools.map(t => `- ${t.name}: ${t.description ?? ""}`).join("\n");
    const toolsBlock = `\n\nYou have access to these tools:\n${toolDescs}\nIf you want to use a tool, output the tool name and arguments in your response.`;
    if (out.messages && Array.isArray(out.messages) && out.messages[0]?.role === "system") {
      (out.messages[0] as Record<string, unknown>).content += toolsBlock;
    }
  }

  return new TextEncoder().encode(JSON.stringify(out));
}
