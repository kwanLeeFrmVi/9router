// Gemini-specific response helpers.

/**
 * Wrap a raw response in a Gemini-style envelope.
 * Input: raw upstream JSON.
 * Output: `{ response: <raw> }`.
 */
export function wrapGeminiResponse(raw: Uint8Array): Uint8Array {
  try {
    const text = new TextDecoder().decode(raw);
    const parsed = JSON.parse(text);
    const wrapped = JSON.stringify({ response: parsed });
    return new TextEncoder().encode(wrapped);
  } catch {
    // If it's not valid JSON, just return the raw bytes as-is
    return raw;
  }
}

/**
 * Parse an SSE data line that may contain a Gemini error.
 */
export function parseGeminiSSEError(data: string): string | null {
  try {
    const parsed = JSON.parse(data);
    if (parsed.error) {
      return parsed.error.message || parsed.error || data;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Build a Gemini-compatible error chunk for SSE stream.
 */
export function geminiErrorChunk(message: string): string {
  return JSON.stringify({ error: { message } });
}