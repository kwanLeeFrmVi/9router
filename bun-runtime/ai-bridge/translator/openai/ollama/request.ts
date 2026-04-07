// OpenAI → Ollama: translate OpenAI format to Ollama format
export function convertOpenAIRequestToOllama(
  modelName: string,
  inputRaw: Uint8Array,
  stream: boolean
): Uint8Array {
  const raw = typeof inputRaw === "string" ? JSON.parse(inputRaw) : JSON.parse(new TextDecoder().decode(inputRaw));
  const out: Record<string, unknown> = {
    model: modelName,
    stream,
    messages: raw.messages ?? [],
  };

  // system message → Ollama system field
  const msgs = raw.messages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(msgs)) {
    const systemMsgs = msgs.filter(m => (m.role as string) === "system");
    if (systemMsgs.length > 0) {
      out.system = systemMsgs.map(m => m.content).join("\n");
      out.messages = msgs.filter(m => (m.role as string) !== "system");
    }
  }

  // temperature → options.temperature
  if (raw.temperature !== undefined) {
    out.options = { temperature: raw.temperature };
  }
  if (raw.top_p !== undefined) {
    out.options = out.options || {};
    (out.options as Record<string, unknown>).top_p = raw.top_p;
  }
  if (raw.max_tokens !== undefined) {
    out.options = out.options || {};
    (out.options as Record<string, unknown>).num_predict = raw.max_tokens;
  }
  if (raw.stop !== undefined) out.stop = raw.stop;
  if (raw.tools !== undefined) out.tools = raw.tools;

  return new TextEncoder().encode(JSON.stringify(out));
}
