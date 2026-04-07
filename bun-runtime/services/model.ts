// Port of src/sse/services/model.js
// Replaced @/lib/localDb → ../db/index

import { getModelAliases, getComboByName, getProviderNodes } from "../db/index.ts";
import {
  parseModel,
  resolveModelAliasFromMap,
  getModelInfoCore,
} from "open-sse/services/model.js";

export { parseModel };

/**
 * Resolve model alias from DB
 */
export async function resolveModelAlias(alias: string): Promise<unknown> {
  const aliases = await getModelAliases();
  return resolveModelAliasFromMap(alias, aliases);
}

/**
 * Get full model info (parse or resolve alias/combo)
 */
export async function getModelInfo(modelStr: string): Promise<{ provider: string | null; model: string }> {
  const parsed = parseModel(modelStr) as { isAlias: boolean; provider: string; providerAlias: string; model: string };

  if (!parsed.isAlias) {
    if (parsed.provider === parsed.providerAlias) {
      const openaiNodes = await getProviderNodes({ type: "openai-compatible" });
      const matchedOpenAI = openaiNodes.find(node => node.prefix === parsed.providerAlias);
      if (matchedOpenAI) {
        return { provider: matchedOpenAI.id as string, model: parsed.model };
      }

      const anthropicNodes = await getProviderNodes({ type: "anthropic-compatible" });
      const matchedAnthropic = anthropicNodes.find(node => node.prefix === parsed.providerAlias);
      if (matchedAnthropic) {
        return { provider: matchedAnthropic.id as string, model: parsed.model };
      }
    }
    return { provider: parsed.provider, model: parsed.model };
  }

  const combo = await getComboByName(parsed.model);
  if (combo) {
    return { provider: null, model: parsed.model };
  }

  return getModelInfoCore(modelStr, getModelAliases) as Promise<{ provider: string | null; model: string }>;
}

/**
 * Check if model is a combo and get models list.
 * Returns array of models or null if not a combo.
 */
export async function getComboModels(modelStr: string): Promise<string[] | null> {
  if (modelStr.includes("/")) return null;
  const combo = await getComboByName(modelStr);
  if (combo && combo.models && combo.models.length > 0) {
    return combo.models;
  }
  return null;
}
