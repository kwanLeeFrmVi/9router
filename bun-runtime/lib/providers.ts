// Provider helpers derived from open-sse's PROVIDER_ID_TO_ALIAS
// Keeps bun-runtime standalone without copying src/shared/constants/providers.js

import { PROVIDER_ID_TO_ALIAS } from "open-sse/config/providerModels.js";

// Invert ID→alias to get alias→ID
const ALIAS_TO_ID: Record<string, string> = Object.fromEntries(
  Object.entries(PROVIDER_ID_TO_ALIAS as Record<string, string>).map(([id, alias]) => [alias, id])
);

/** Resolve provider alias → canonical ID (e.g. "kc" → "kilocode") */
export function resolveProviderId(aliasOrId: string): string {
  return ALIAS_TO_ID[aliasOrId] ?? aliasOrId;
}

/** Get alias from provider ID (e.g. "kilocode" → "kc") */
export function getProviderAlias(providerId: string): string {
  return (PROVIDER_ID_TO_ALIAS as Record<string, string>)[providerId] ?? providerId;
}

/** Matches openai-compatible-* provider IDs (custom nodes) */
export function isOpenAICompatibleProvider(providerId: string): boolean {
  return typeof providerId === "string" && providerId.startsWith("openai-compatible-");
}

/** Matches anthropic-compatible-* provider IDs (custom nodes) */
export function isAnthropicCompatibleProvider(providerId: string): boolean {
  return typeof providerId === "string" && providerId.startsWith("anthropic-compatible-");
}
