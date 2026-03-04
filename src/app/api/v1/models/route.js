import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "@/shared/constants/models";
import { getProviderAlias, isOpenAICompatibleProvider, isAnthropicCompatibleProvider } from "@/shared/constants/providers";
import { getProviderConnections, getCombos, getModelAliases } from "@/lib/localDb";

/**
 * Handle CORS preflight
 */
export async function OPTIONS() {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}

/**
 * GET /v1/models - OpenAI compatible models list
 * Returns models from all active providers and combos in OpenAI format
 */
export async function GET() {
  try {
    // Get active provider connections
    let connections = [];
    try {
      connections = await getProviderConnections();
      // Filter to only active connections
      connections = connections.filter(c => c.isActive !== false);
    } catch (e) {
      // If database not available, return all models
      console.log("Could not fetch providers, returning all models");
    }

    // Get combos
    let combos = [];
    try {
      combos = await getCombos();
    } catch (e) {
      console.log("Could not fetch combos");
    }

    // Build first active connection per provider (connections already sorted by priority)
    const activeConnectionByProvider = new Map();
    for (const conn of connections) {
      if (!activeConnectionByProvider.has(conn.provider)) {
        activeConnectionByProvider.set(conn.provider, conn);
      }
    }

    // Collect models from active providers (or all if none active)
    const models = [];
    const timestamp = Math.floor(Date.now() / 1000);

    // Add combos first (they appear at the top)
    for (const combo of combos) {
      models.push({
        id: combo.name,
        object: "model",
        created: timestamp,
        owned_by: "combo",
        permission: [],
        root: combo.name,
        parent: null,
      });
    }

    // Add provider models
    if (connections.length === 0) {
      // DB unavailable or no active providers -> return all static models
      for (const [alias, providerModels] of Object.entries(PROVIDER_MODELS)) {
        for (const model of providerModels) {
          models.push({
            id: `${alias}/${model.id}`,
            object: "model",
            created: timestamp,
            owned_by: alias,
            permission: [],
            root: model.id,
            parent: null,
          });
        }
      }
    } else {
      // Fetch model aliases to include alias-based models (used by compatible providers)
      let modelAliases = {};
      try {
        modelAliases = await getModelAliases();
      } catch (e) {
        console.log("Could not fetch model aliases");
      }

      for (const [providerId, conn] of activeConnectionByProvider.entries()) {
        const staticAlias = PROVIDER_ID_TO_ALIAS[providerId] || providerId;
        const outputAlias = getProviderAlias(providerId) || staticAlias;
        const providerModels = PROVIDER_MODELS[staticAlias] || [];
        const enabledModels = conn?.providerSpecificData?.enabledModels;
        const hasExplicitEnabledModels =
          Array.isArray(enabledModels) && enabledModels.length > 0;

        const isCompatible = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

        // For compatible providers, models are stored as aliases (alias → providerId/modelId).
        // Extract model IDs from aliases that belong to this provider.
        if (isCompatible && !hasExplicitEnabledModels) {
          const prefix = `${providerId}/`;
          const aliasModelIds = Object.values(modelAliases)
            .filter((fullModel) => typeof fullModel === "string" && fullModel.startsWith(prefix))
            .map((fullModel) => fullModel.slice(prefix.length))
            .filter((modelId) => modelId.trim() !== "");

          const uniqueModelIds = Array.from(new Set(aliasModelIds));
          for (const modelId of uniqueModelIds) {
            models.push({
              id: `${outputAlias}/${modelId}`,
              object: "model",
              created: timestamp,
              owned_by: outputAlias,
              permission: [],
              root: modelId,
              parent: null,
            });
          }
          continue;
        }

        // Default: if no explicit selection, all static models are active.
        // If explicit selection exists, expose exactly those model IDs (including non-static IDs).
        const rawModelIds = hasExplicitEnabledModels
          ? Array.from(
            new Set(
              enabledModels.filter(
                (modelId) => typeof modelId === "string" && modelId.trim() !== "",
              ),
            ),
          )
          : providerModels.map((model) => model.id);

        const modelIds = rawModelIds
          .map((modelId) => {
            if (modelId.startsWith(`${outputAlias}/`)) {
              return modelId.slice(outputAlias.length + 1);
            }
            if (modelId.startsWith(`${staticAlias}/`)) {
              return modelId.slice(staticAlias.length + 1);
            }
            if (modelId.startsWith(`${providerId}/`)) {
              return modelId.slice(providerId.length + 1);
            }
            return modelId;
          })
          .filter((modelId) => typeof modelId === "string" && modelId.trim() !== "");

        for (const modelId of modelIds) {
          models.push({
            id: `${outputAlias}/${modelId}`,
            object: "model",
            created: timestamp,
            owned_by: outputAlias,
            permission: [],
            root: modelId,
            parent: null,
          });
        }
      }
    }

    return Response.json({
      object: "list",
      data: models,
    }, {
      headers: {
        "Access-Control-Allow-Origin": "*",
      },
    });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: error.message, type: "server_error" } },
      { status: 500 }
    );
  }
}
