// Thinking budget ↔ reasoning effort level conversion.
// Maps Anthropic thinking.budget_tokens to OpenAI reasoning_effort and back.

export const THINKING_LEVELS = {
  OFF:  "off",
  LOW:  "low",
  MEDIUM: "medium",
  HIGH: "high",
  XHIGH: "x-high",
} as const;

export type ThinkingLevel = typeof THINKING_LEVELS[keyof typeof THINKING_LEVELS] | "";

// Mapping from budget token values to OpenAI reasoning_effort strings.
// These match Anthropic's known budget→effort mapping.
const BUDGET_TO_LEVEL: Array<[number, ThinkingLevel]> = [
  [0,       ""],     // disabled → ""
  [1024,    THINKING_LEVELS.LOW],
  [4096,    THINKING_LEVELS.LOW],
  [8192,    THINKING_LEVELS.MEDIUM],
  [16384,   THINKING_LEVELS.HIGH],
  [20000,   THINKING_LEVELS.HIGH],
  [32000,   THINKING_LEVELS.XHIGH],
  [50000,   THINKING_LEVELS.XHIGH],
  [64000,   THINKING_LEVELS.XHIGH],
];

/**
 * Convert Claude thinking.budget_tokens to OpenAI reasoning_effort.
 * -1 = enabled, use default. 0 = disabled.
 */
export function convertBudgetToLevel(budgetTokens: number): { effort: ThinkingLevel; ok: boolean } {
  if (budgetTokens === -1) return { effort: THINKING_LEVELS.MEDIUM, ok: true };
  if (budgetTokens === 0)  return { effort: "", ok: true };

  // Find the closest level for the given budget
  let closest: [number, ThinkingLevel] = BUDGET_TO_LEVEL[0]!;
  let minDiff = Math.abs(budgetTokens - closest[0]);

  for (const entry of BUDGET_TO_LEVEL) {
    const diff = Math.abs(budgetTokens - entry[0]);
    if (diff < minDiff) {
      minDiff = diff;
      closest = entry;
    }
  }

  return { effort: closest[1], ok: closest[1] !== "" };
}

/**
 * Extract thinking text from an Anthropic thinking content block.
 */
export function getThinkingText(part: Record<string, unknown>): string {
  if (part.type === "thinking") {
    return String(part.thinking ?? "");
  }
  return "";
}

/**
 * Parse an effort string (from OpenAI) to a budget token value (for Claude).
 * Inverse of convertBudgetToLevel.
 */
export function levelToBudget(effort: string): number | null {
  switch (effort?.toLowerCase()) {
    case "off":     return 0;
    case "low":     return 4096;
    case "medium":  return 8192;
    case "high":    return 16384;
    case "x-high":  return 32000;
    default:        return null;
  }
}

/**
 * Build an Anthropic thinking content block from reasoning content text.
 */
export function buildThinkingBlock(text: string): object {
  return { type: "thinking", thinking: text };
}