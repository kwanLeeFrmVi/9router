import { getSettings, getApiKeyByKey } from "../db/index.ts";
import { extractApiKey, isValidApiKey } from "../services/auth.ts";
import { errorResponse } from "open-sse/utils/error.js";
import { HTTP_STATUS } from "open-sse/config/runtimeConfig.js";
import * as log from "./logger.ts";

export type AuthResult =
  | { ok: true; apiKey: string | null }
  | { ok: false; response: Response };

/**
 * Validate the incoming API key against settings.requireApiKey.
 * Logs key identity when present. Returns an error Response if auth fails.
 */
export async function checkAuth(request: Request): Promise<AuthResult> {
  const apiKey = extractApiKey(request);

  if (request.headers.get("Authorization") && apiKey) {
    const keyRecord = await getApiKeyByKey(apiKey);
    const keyName = (keyRecord?.name as string | undefined) ?? "unnamed";
    log.debug("AUTH", `API Key: ${log.maskKey(apiKey)} (${keyName})`);
  } else {
    log.debug("AUTH", "No API key provided (local mode)");
  }

  const settings = await getSettings();
  if (settings.requireApiKey) {
    if (!apiKey) {
      log.warn("AUTH", "Missing API key");
      return { ok: false, response: errorResponse(HTTP_STATUS.UNAUTHORIZED, "Missing API key") as Response };
    }
    const valid = await isValidApiKey(apiKey);
    if (!valid) {
      log.warn("AUTH", "Invalid API key");
      return { ok: false, response: errorResponse(HTTP_STATUS.UNAUTHORIZED, "Invalid API key") as Response };
    }
  }

  return { ok: true, apiKey };
}
