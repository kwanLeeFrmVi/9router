// Token count JSON helpers.
// Generates SSE/JSON payloads for token usage metadata.

/**
 * Format Claude input token count as JSON.
 */
export function formatClaudeTokens(count: number): string {
  return JSON.stringify({ input_tokens: count });
}

/**
 * Format Gemini token count as a more detailed JSON structure.
 */
export function formatGeminiTokens(totalTokens: number): string {
  return JSON.stringify({
    totalTokens,
    promptTokensDetails: [{ modality: "TEXT", tokenCount: totalTokens }],
  });
}

/**
 * Build a complete Claude usage object from token counts.
 */
export function buildClaudeUsage(
  inputTokens: number,
  outputTokens: number,
  cachedTokens = 0
): Record<string, number> {
  const usage: Record<string, number> = {
    input_tokens: inputTokens,
    output_tokens: outputTokens,
  };
  if (cachedTokens > 0) usage.cache_read_input_tokens = cachedTokens;
  return usage;
}

/**
 * Extract token counts from OpenAI-style usage object.
 */
export function extractTokensFromOpenAIUsage(usage: Record<string, unknown> | null): {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
} {
  if (!usage) return { inputTokens: 0, outputTokens: 0, cachedTokens: 0 };

  const promptTokens     = (usage.prompt_tokens as number) ?? 0;
  const completionTokens = (usage.completion_tokens as number) ?? 0;
  let cachedTokens       = (usage.prompt_tokens_details as Record<string, number>)?.cached_tokens ?? 0;

  // Subtract cached from prompt to get actual non-cached input tokens
  if (cachedTokens > 0 && promptTokens >= cachedTokens) {
    return { inputTokens: promptTokens - cachedTokens, outputTokens: completionTokens, cachedTokens };
  }
  return { inputTokens: promptTokens, outputTokens: completionTokens, cachedTokens };
}