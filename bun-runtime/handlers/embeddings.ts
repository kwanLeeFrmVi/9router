// Port of src/sse/handlers/embeddings.js
// Replaced @/lib/localDb → ../db/index
// Replaced ../utils/logger.js → ../lib/logger

import {
  getProviderCredentials,
  markAccountUnavailable,
  clearAccountError,
} from "../services/auth.ts";
import { checkAuth } from "../lib/authMiddleware.ts";
import { getModelInfo } from "../services/model.ts";
import { handleEmbeddingsCore } from "open-sse/handlers/embeddingsCore.js";
import { errorResponse, unavailableResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "../lib/logger.ts";
import { updateProviderCredentials, checkAndRefreshToken } from "../services/tokenRefresh.ts";

/**
 * Handle embeddings request.
 * Follows the same auth + fallback pattern as handleChat.
 */
export async function handleEmbeddings(request: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    log.warn("EMBEDDINGS", "Invalid JSON body");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid JSON body") as Response;
  }

  const url = new URL(request.url);
  const modelStr = body.model as string;

  log.request("POST", `${url.pathname} | ${modelStr}`);

  const auth = await checkAuth(request);
  if (!auth.ok) return auth.response;

  if (!modelStr) {
    log.warn("EMBEDDINGS", "Missing model");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing model") as Response;
  }

  if (!body.input) {
    log.warn("EMBEDDINGS", "Missing input");
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Missing required field: input") as Response;
  }

  const modelInfo = await getModelInfo(modelStr);
  if (!modelInfo.provider) {
    log.warn("EMBEDDINGS", "Invalid model format", { model: modelStr });
    return errorResponse(HTTP_STATUS.BAD_REQUEST, "Invalid model format") as Response;
  }

  const { provider, model } = modelInfo as { provider: string; model: string };

  if (modelStr !== `${provider}/${model}`) {
    log.info("ROUTING", `${modelStr} → ${provider}/${model}`);
  } else {
    log.info("ROUTING", `Provider: ${provider}, Model: ${model}`);
  }

  const excludeConnectionIds = new Set<string>();
  let lastError: string | null = null;
  let lastStatus: number | null = null;

  while (true) {
    const credentials = await getProviderCredentials(provider, excludeConnectionIds, model);

    if (!credentials || (credentials as Record<string, unknown>).allRateLimited) {
      const creds = credentials as Record<string, unknown> | null;
      if (creds?.allRateLimited) {
        const errorMsg = lastError ?? (creds.lastError as string | undefined) ?? "Unavailable";
        const status = lastStatus ?? (Number(creds.lastErrorCode) || HTTP_STATUS.SERVICE_UNAVAILABLE);
        log.warn("EMBEDDINGS", `[${provider}/${model}] ${errorMsg} (${creds.retryAfterHuman})`);
        return unavailableResponse(status, `[${provider}/${model}] ${errorMsg}`, creds.retryAfter as string, creds.retryAfterHuman as string) as Response;
      }
      if (excludeConnectionIds.size === 0) {
        log.error("AUTH", `No credentials for provider: ${provider}`);
        return errorResponse(HTTP_STATUS.BAD_REQUEST, `No credentials for provider: ${provider}`) as Response;
      }
      log.warn("EMBEDDINGS", "No more accounts available", { provider });
      return errorResponse(lastStatus ?? HTTP_STATUS.SERVICE_UNAVAILABLE, lastError ?? "All accounts unavailable") as Response;
    }

    const creds = credentials as Record<string, unknown>;
    log.info("AUTH", `\x1b[32mUsing ${provider} account: ${creds.connectionName}\x1b[0m`);

    const refreshedCredentials = await checkAndRefreshToken(provider, creds);

    const result = await handleEmbeddingsCore({
      body: { ...body, model: `${provider}/${model}` },
      modelInfo: { provider, model },
      credentials: refreshedCredentials,
      log,
      onCredentialsRefreshed: async (newCreds: Record<string, unknown>) => {
        await updateProviderCredentials(creds.connectionId as string, {
          accessToken: newCreds.accessToken,
          refreshToken: newCreds.refreshToken,
          providerSpecificData: newCreds.providerSpecificData,
          testStatus: "active",
        });
      },
      onRequestSuccess: async () => {
        await clearAccountError(creds.connectionId as string, creds, model);
      },
    }) as { success: boolean; response: Response; status: number; error: string };

    if (result.success) return result.response;

    const { shouldFallback } = await markAccountUnavailable(
      creds.connectionId as string,
      result.status,
      result.error,
      provider,
      model
    );

    if (shouldFallback) {
      log.warn("AUTH", `Account ${creds.connectionName} unavailable (${result.status}), trying fallback`);
      excludeConnectionIds.add(creds.connectionId as string);
      lastError = result.error;
      lastStatus = result.status;
      continue;
    }

    return result.response;
  }
}
