// Shared translator utilities.

/**
 * Sanitize a tool call ID to be valid for Anthropic format.
 * Anthropic requires tool use IDs to match ^tool_[a-z0-9]{26}$.
 */
export function sanitizeClaudeToolID(id: string): string {
  if (!id) return `tool_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  // Replace any non-alphanumeric chars with underscores
  return id.replace(/[^a-zA-Z0-9]/g, "_");
}

/**
 * Extract tool name map from a translated request's _toolNameMap field.
 * Used by response translators to reverse-map tool names back to original.
 */
export function toolNameMapFromRequest(
  rawJSON: Uint8Array | string | object
): Map<string, string> {
  const map = new Map<string, string>();
  try {
    const obj = typeof rawJSON === "string"
      ? JSON.parse(rawJSON)
      : rawJSON instanceof Uint8Array
      ? JSON.parse(new TextDecoder().decode(rawJSON))
      : rawJSON;

    if (obj._toolNameMap instanceof Map) return obj._toolNameMap;
    if (typeof obj._toolNameMap === "object" && obj._toolNameMap !== null) {
      for (const [k, v] of Object.entries(obj._toolNameMap)) {
        map.set(k, String(v));
      }
    }
  } catch {
    // ignore parse errors
  }
  return map;
}

/**
 * Map a tool name through the tool name map (reverse for response translation).
 */
export function mapToolName(toolNameMap: Map<string, string> | null, name: string): string {
  if (!toolNameMap || toolNameMap.size === 0) return name;
  // Reverse map: find original key that maps to this name
  for (const [original, translated] of toolNameMap.entries()) {
    if (translated === name) return original;
  }
  return name;
}

/**
 * Try to fix a partial JSON string by completing the last object/array.
 * Used when accumulating tool call arguments across streaming chunks.
 */
export function fixPartialJSON(partial: string): string {
  const trimmed = partial.trimEnd();
  if (!trimmed) return trimmed;

  let openBraces = 0;
  let openBrackets = 0;
  let inString = false;
  let escape = false;

  for (const char of trimmed) {
    if (escape) { escape = false; continue; }
    if (char === "\\") { escape = true; continue; }
    if (char === '"') { inString = !inString; continue; }
    if (inString) continue;

    if (char === "{") openBraces++;
    else if (char === "}") openBraces--;
    else if (char === "[") openBrackets++;
    else if (char === "]") openBrackets--;
  }

  let result = trimmed;
  // Close braces
  for (let i = 0; i < openBraces; i++) result += "}";
  // Close brackets
  for (let i = 0; i < openBrackets; i++) result += "]";

  // If it looks like the last token is an unclosed string, try to close it
  if (!isValidJSON(result)) {
    // Try adding a closing quote and braces
    const withQuote = result + '"';
    if (isValidJSON(withQuote + "}")) return withQuote + "}";
  }

  return result;
}

/**
 * Check if a string is valid JSON.
 */
export function isValidJSON(s: string): boolean {
  try { JSON.parse(s); return true; } catch { return false; }
}

/**
 * Ensure tool_calls array entries have an `id` field.
 * Some providers require this even though OpenAI spec allows omitting it.
 */
export function ensureToolCallIds(body: Record<string, unknown>): void {
  const messages = body.messages as Array<Record<string, unknown>> | undefined;
  if (!messages) return;

  for (const msg of messages) {
    const content = msg.content;
    if (!Array.isArray(content)) continue;

    for (const part of content) {
      if (part && typeof part === "object" && (part as Record<string, unknown>).type === "tool_calls") {
        const calls = (part as Record<string, unknown>).tool_calls as Array<Record<string, unknown>> | undefined;
        if (!Array.isArray(calls)) continue;
        for (const call of calls) {
          if (!call.id) {
            call.id = `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
          }
        }
      }
    }
  }
}