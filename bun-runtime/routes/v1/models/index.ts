// Port of src/app/api/v1/models/route.js
import { PROVIDER_MODELS, PROVIDER_ID_TO_ALIAS } from "ai-bridge/config/providerModels.ts";
import { getProviderAlias, isAnthropicCompatibleProvider, isOpenAICompatibleProvider } from "lib/providers.ts";
import { getProviderConnections, getCombos } from "db/index.ts";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

const providerModels = PROVIDER_MODELS as Record<string, Array<{ id: string; name?: string }>>;
const providerIdToAlias = PROVIDER_ID_TO_ALIAS as Record<string, string>;

function parseOpenAIStyleModels(data: unknown): Array<{ id?: string; name?: string; model?: string }> {
  if (Array.isArray(data)) return data as Array<{ id?: string; name?: string; model?: string }>;
  const d = data as Record<string, unknown>;
  return (d?.data ?? d?.models ?? d?.results ?? []) as Array<{ id?: string; name?: string; model?: string }>;
}

async function fetchCompatibleModelIds(connection: Record<string, unknown>): Promise<string[]> {
  if (!connection?.apiKey) return [];

  const psd = (connection.providerSpecificData as Record<string, unknown> | undefined) ?? {};
  const baseUrl = typeof psd.baseUrl === "string" ? psd.baseUrl.trim().replace(/\/$/, "") : "";
  if (!baseUrl) return [];

  let url = `${baseUrl}/models`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };

  if (isOpenAICompatibleProvider(connection.provider as string)) {
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else if (isAnthropicCompatibleProvider(connection.provider as string)) {
    if (url.endsWith("/messages/models")) url = url.slice(0, -9);
    else if (url.endsWith("/messages")) url = `${url.slice(0, -9)}/models`;
    headers["x-api-key"] = connection.apiKey as string;
    headers["anthropic-version"] = "2023-06-01";
    headers.Authorization = `Bearer ${connection.apiKey}`;
  } else {
    return [];
  }

  try {
    const response = await fetch(url, { method: "GET", headers, cache: "no-store" });
    if (!response.ok) return [];
    const data = await response.json();
    const rawModels = parseOpenAIStyleModels(data);
    return Array.from(
      new Set(
        rawModels
          .map(m => m?.id ?? m?.name ?? m?.model)
          .filter((id): id is string => typeof id === "string" && id.trim() !== "")
      )
    );
  } catch {
    return [];
  }
}

export async function GET(_req: Request): Promise<Response> {
  try {
    let connections: Record<string, unknown>[] = [];
    try {
      connections = (await getProviderConnections()).filter(c => c.isActive !== false);
    } catch {
      console.log("Could not fetch providers, returning all models");
    }

    let combos: { name: string }[] = [];
    try {
      combos = await getCombos();
    } catch {
      console.log("Could not fetch combos");
    }

    const activeConnectionByProvider = new Map<string, Record<string, unknown>>();
    for (const conn of connections) {
      if (!activeConnectionByProvider.has(conn.provider as string)) {
        activeConnectionByProvider.set(conn.provider as string, conn);
      }
    }

    const models: unknown[] = [];
    const timestamp = Math.floor(Date.now() / 1000);

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

    if (connections.length === 0) {
      for (const [alias, pModels] of Object.entries(providerModels)) {
        for (const model of pModels) {
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
      for (const [providerId, conn] of activeConnectionByProvider.entries()) {
        const staticAlias = providerIdToAlias[providerId] ?? providerId;
        const psd = (conn.providerSpecificData as Record<string, unknown> | undefined) ?? {};
        const outputAlias = ((psd.prefix as string | undefined) ?? getProviderAlias(providerId) ?? staticAlias).trim();
        const pModels = providerModels[staticAlias] ?? [];
        const enabledModels = psd.enabledModels as string[] | undefined;
        const hasExplicitEnabledModels = Array.isArray(enabledModels) && enabledModels.length > 0;
        const isCompatibleProvider = isOpenAICompatibleProvider(providerId) || isAnthropicCompatibleProvider(providerId);

        let rawModelIds: string[] = hasExplicitEnabledModels
          ? Array.from(new Set(enabledModels.filter((id): id is string => typeof id === "string" && id.trim() !== "")))
          : pModels.map(m => m.id);

        if (isCompatibleProvider && rawModelIds.length === 0) {
          rawModelIds = await fetchCompatibleModelIds(conn);
        }

        const modelIds = rawModelIds
          .map(modelId => {
            if (modelId.startsWith(`${outputAlias}/`)) return modelId.slice(outputAlias.length + 1);
            if (modelId.startsWith(`${staticAlias}/`)) return modelId.slice(staticAlias.length + 1);
            if (modelId.startsWith(`${providerId}/`)) return modelId.slice(providerId.length + 1);
            return modelId;
          })
          .filter((id): id is string => typeof id === "string" && id.trim() !== "");

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

    return Response.json({ object: "list", data: models }, { headers: CORS_HEADERS });
  } catch (error) {
    console.log("Error fetching models:", error);
    return Response.json(
      { error: { message: (error as Error).message, type: "server_error" } },
      { status: 500 }
    );
  }
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/v1/models", { GET, OPTIONS });
