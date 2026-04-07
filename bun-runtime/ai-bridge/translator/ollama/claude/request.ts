// Translates Ollama format → Anthropic API format
export function convertOllamaRequestToClaude(
  modelName: string,
  inputRaw: Uint8Array
): Uint8Array {
  const raw = typeof inputRaw === "string" ? JSON.parse(inputRaw) : JSON.parse(new TextDecoder().decode(inputRaw));
  const out: Record<string, unknown> = { model: modelName };

  // options → temperature, num_predict, etc.
  const options = raw.options as Record<string, unknown> | undefined;
  if (options) {
    if (options.temperature !== undefined) out.temperature = options.temperature;
    if (options.num_predict !== undefined) out.max_tokens = options.num_predict;
  }

  // stop → stop_sequences
  if (raw.stop !== undefined) {
    out.stop_sequences = Array.isArray(raw.stop) ? raw.stop : [raw.stop];
  }

  // stream
  out.stream = raw.stream ?? false;

  // messages → same as OpenAI
  const messages: Array<Record<string, unknown>> = [];
  const rawMessages = raw.messages as Array<Record<string, unknown>> | undefined;
  if (Array.isArray(rawMessages)) {
    for (const msg of rawMessages) {
      const role = msg.role as string;
      const content = msg.content as string | undefined;
      if (content) {
        messages.push({ role, content });
      }
    }
  }
  if (messages.length > 0) out.messages = messages;

  // system → system
  if (raw.system !== undefined) {
    out.system = raw.system;
  }

  return new TextEncoder().encode(JSON.stringify(out));
}
