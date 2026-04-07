// Ollama → OpenAI: Ollama IS OpenAI-compatible, so this is essentially identity
export function convertOllamaRequestToOpenAI(
  modelName: string,
  inputRaw: Uint8Array,
  stream: boolean
): Uint8Array {
  const raw = typeof inputRaw === "string" ? JSON.parse(inputRaw) : JSON.parse(new TextDecoder().decode(inputRaw));
  const out: Record<string, unknown> = {
    model: modelName,
    stream,
  };

  // Copy relevant fields
  if (raw.messages !== undefined) out.messages = raw.messages;
  if (raw.system !== undefined) out.system = raw.system;
  if (raw.options !== undefined) {
    const opts = raw.options as Record<string, unknown>;
    if (opts.temperature !== undefined) out.temperature = opts.temperature;
    if (opts.top_p !== undefined) out.top_p = opts.top_p;
    if (opts.num_predict !== undefined) out.max_tokens = opts.num_predict;
    if (opts.stop !== undefined) out.stop = opts.stop;
  }
  if (raw.stop !== undefined) out.stop = raw.stop;
  if (raw.tools !== undefined) out.tools = raw.tools;

  return new TextEncoder().encode(JSON.stringify(out));
}
