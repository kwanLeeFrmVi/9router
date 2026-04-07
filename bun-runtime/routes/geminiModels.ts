// Port of src/app/api/v1beta/models/route.js
import { PROVIDER_MODELS } from "open-sse/config/providerModels.js";
import { CORS_HEADERS } from "../lib/cors.ts";

const providerModels = PROVIDER_MODELS as Record<string, Array<{ id: string; name?: string }>>;

export function geminiModelsHandler(_req: Request): Response {
  try {
    const models: unknown[] = [];

    for (const [provider, pModels] of Object.entries(providerModels)) {
      for (const model of pModels) {
        models.push({
          name: `models/${provider}/${model.id}`,
          displayName: model.name ?? model.id,
          description: `${provider} model: ${model.name ?? model.id}`,
          supportedGenerationMethods: ["generateContent"],
          inputTokenLimit: 128000,
          outputTokenLimit: 8192,
        });
      }
    }

    return Response.json({ models }, { headers: CORS_HEADERS });
  } catch (error) {
    return Response.json({ error: { message: (error as Error).message } }, { status: 500 });
  }
}
