import { getSettings, getApiKeyByKey, getSessionByToken, getUserById } from "../db/index.ts";
import { extractApiKey, isValidApiKey } from "../services/auth.ts";
import { errorResponse } from "../ai-bridge/utils/error.ts";
import { HTTP_STATUS } from "../ai-bridge/config/runtimeConfig.ts";
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

export type AdminAuthResult =
  | { ok: true; userId: string }
  | { ok: false; response: Response };

/**
 * Validate a user session token for management endpoints.
 * Always enforced — independent of requireApiKey setting.
 */
export async function checkAdminAuth(request: Request): Promise<AdminAuthResult> {
  const authHeader = request.headers.get("Authorization");
  const token = authHeader?.startsWith("Bearer ") ? authHeader.slice(7).trim() : null;

  if (!token) {
    return { ok: false, response: Response.json({ error: "Unauthorized" }, { status: 401 }) };
  }

  const session = await getSessionByToken(token);
  if (!session) {
    return { ok: false, response: Response.json({ error: "Invalid or expired session" }, { status: 401 }) };
  }

  const user = await getUserById(session.userId);
  if (!user) {
    return { ok: false, response: Response.json({ error: "User not found" }, { status: 401 }) };
  }

  log.debug("AUTH", `Session valid for user: ${user.username}`);
  return { ok: true, userId: session.userId };
}
