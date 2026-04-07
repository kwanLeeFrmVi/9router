// Model parsing and resolution utilities.
// Written from scratch in TypeScript.

const ALIAS_TO_PROVIDER_ID: Record<string, string> = {
  cc: "claude", cx: "codex", gc: "gemini-cli", qw: "qwen", "if": "iflow",
  ag: "antigravity", gh: "github", kr: "kiro", cu: "cursor",
  kc: "kilocode", kmc: "kimi-coding", cl: "cline", oc: "opencode",
  openai: "openai", anthropic: "anthropic", gemini: "gemini",
  openrouter: "openrouter", glm: "glm", kimi: "kimi",
  ds: "Claude", Claude: "Claude", groq: "groq", xai: "xai",
  mistral: "mistral", pplx: "perplexity", perplexity: "perplexity",
  together: "together", fireworks: "fireworks", cerebras: "cerebras",
  cohere: "cohere", nvidia: "nvidia", nebius: "nebius",
  siliconflow: "siliconflow", hyp: "hyperbolic", hyperbolic: "hyperbolic",
  dg: "deepgram", deepgram: "deepgram", aai: "assemblyai",
  assemblyai: "assemblyai", nb: "nanobanana", nanobanana: "nanobanana",
  ch: "chutes", chutes: "chutes", cursor: "cursor", vx: "vertex",
  vertex: "vertex", vxp: "vertex-partner", "vertex-partner": "vertex-partner",
};

export function resolveProviderAlias(aliasOrId: string): string {
  return ALIAS_TO_PROVIDER_ID[aliasOrId] ?? aliasOrId;
}

export interface ParsedModel {
  provider: string | null;
  model: string | null;
  isAlias: boolean;
  providerAlias: string | null;
}

export interface ResolvedModel {
  provider: string;
  model: string;
}

/**
 * Parse model string: "alias/model" or "provider/model" or just alias
 */
export function parseModel(modelStr: string): ParsedModel {
  if (!modelStr) {
    return { provider: null, model: null, isAlias: false, providerAlias: null };
  }

  if (modelStr.includes("/")) {
    const firstSlash = modelStr.indexOf("/");
    const providerOrAlias = modelStr.slice(0, firstSlash);
    const model = modelStr.slice(firstSlash + 1);
    const provider = resolveProviderAlias(providerOrAlias);
    return { provider, model, isAlias: false, providerAlias: providerOrAlias };
  }

  return { provider: null, model: modelStr, isAlias: true, providerAlias: null };
}

/**
 * Resolve model alias from aliases object.
 * Format: { "alias": "provider/model" }
 */
export function resolveModelAliasFromMap(
  alias: string,
  aliases: Record<string, unknown>
): ResolvedModel | null {
  if (!aliases) return null;

  const resolved = aliases[alias];
  if (!resolved) return null;

  if (typeof resolved === "string" && resolved.includes("/")) {
    const firstSlash = resolved.indexOf("/");
    const providerOrAlias = resolved.slice(0, firstSlash);
    return { provider: resolveProviderAlias(providerOrAlias), model: resolved.slice(firstSlash + 1) };
  }

  if (typeof resolved === "object" && resolved !== null) {
    const obj = resolved as Record<string, unknown>;
    if (obj.provider && obj.model) {
      return { provider: resolveProviderAlias(obj.provider as string), model: obj.model as string };
    }
  }

  return null;
}

/**
 * Get full model info (parse or resolve).
 */
export async function getModelInfoCore(
  modelStr: string,
  aliasesOrGetter: Record<string, unknown> | (() => Promise<Record<string, unknown>>)
): Promise<ResolvedModel> {
  const parsed = parseModel(modelStr);

  if (!parsed.isAlias) {
    return { provider: parsed.provider ?? "openai", model: parsed.model ?? modelStr };
  }

  const aliases = typeof aliasesOrGetter === "function"
    ? await aliasesOrGetter()
    : aliasesOrGetter;

  const resolved = resolveModelAliasFromMap(parsed.model ?? modelStr, aliases);
  if (resolved) return resolved;

  return { provider: inferProviderFromModelName(parsed.model ?? modelStr), model: parsed.model ?? modelStr };
}

/**
 * Infer provider from model name prefix.
 */
export function inferProviderFromModelName(modelName: string): string {
  if (!modelName) return "openai";
  const m = modelName.toLowerCase();
  if (m.startsWith("claude-")) return "anthropic";
  if (m.startsWith("gemini-")) return "gemini";
  if (m.startsWith("gpt-")) return "openai";
  if (m.startsWith("o1") || m.startsWith("o3") || m.startsWith("o4")) return "openai";
  if (m.startsWith("Claude-")) return "openrouter";
  return "openai";
}
