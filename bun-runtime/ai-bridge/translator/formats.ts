// Format identifiers for the translator registry.
// Each provider format is represented by a unique string literal type.

export const FORMATS = {
  OPENAI:             "openai",
  OPENAI_RESPONSES:   "openai-responses",
  OPENAI_RESPONSE:    "openai-response",
  CLAUDE:             "claude",
  GEMINI:             "gemini",
  GEMINI_CLI:         "gemini-cli",
  VERTEX:             "vertex",
  CODEX:              "codex",
  ANTIGRAVITY:        "antigravity",
  KIRO:               "kiro",
  CURSOR:             "cursor",
  OLLAMA:             "ollama",
} as const;

export type Format = typeof FORMATS[keyof typeof FORMATS];

// Canonical list for iteration
export const ALL_FORMATS = Object.values(FORMATS);

/**
 * Parse a string into a Format enum value.
 * Falls back to "openai" if unknown.
 */
export function fromString(s: string): Format {
  if (s in FORMATS) return FORMATS[s as keyof typeof FORMATS];
  return FORMATS.OPENAI;
}

/**
 * Detect source format from request URL pathname + body.
 * Returns null to fall back to body-based detection.
 */
export function detectFormatByEndpoint(pathname: string, body: Record<string, unknown> | null): Format | null {
  if (pathname.includes("/v1/responses"))  return FORMATS.OPENAI_RESPONSES;
  if (pathname.includes("/v1/messages"))    return FORMATS.CLAUDE;
  // /v1/chat/completions + input[] → treat as openai (Cursor CLI sends Responses body via chat endpoint)
  if (pathname.includes("/v1/chat/completions") && Array.isArray(body?.input)) {
    return FORMATS.OPENAI;
  }
  return null;
}