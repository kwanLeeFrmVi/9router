// Real implementation for usage tracking — writes to usage_log SQLite table.
// open-sse internals import these; bun-runtime previously stubbed them out.

import { EventEmitter } from "events";
import type { Database } from "bun:sqlite";

// ─── DB singleton (inline to avoid circular dep on full db/index.ts) ───────────

let _db: Database | null = null;

function db(): Database {
  if (_db) return _db;
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  // biome-ignore start: bun:sqlite is only available in Bun runtime
  const Database = require("bun:sqlite").Database as { new (path: string): Database };
  // biome-ignore end
  const { join } = require("node:path");
  const { homedir } = require("node:os");
  const dataDir = process.env.DATA_DIR ?? join(homedir(), ".9router");
  _db = new Database(join(dataDir, "router.db"));
  return _db;
}

// ─── In-memory state ───────────────────────────────────────────────────────────

interface PendingRequest {
  requestId: string;
  timestamp: string;
  endpoint?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  apiKeyId?: string;
  startTime: number;
}

const pendingRequests = new Map<string, PendingRequest>();

export const statsEmitter = new EventEmitter();
statsEmitter.setMaxListeners(50);

// ─── Helpers ───────────────────────────────────────────────────────────────────

function periodToTimestamp(period: string): string | null {
  const now = Date.now();
  switch (period) {
    case "24h": return new Date(now - 24 * 60 * 60 * 1000).toISOString();
    case "7d":  return new Date(now - 7  * 24 * 60 * 60 * 1000).toISOString();
    case "30d": return new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString();
    case "all": return null;
    default:    return new Date(now - 24 * 60 * 60 * 1000).toISOString();
  }
}

export interface UsageRecord {
  id: string;
  timestamp: string;
  endpoint?: string;
  provider?: string;
  model?: string;
  connectionId?: string;
  apiKeyId?: string;
  status: string;
  promptTokens: number;
  completionTokens: number;
  reasoningTokens: number;
  cachedTokens: number;
  cost: number;
  durationMs: number;
}

export interface UsageStats {
  totalRequests: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalCost: number;
  byProvider: { provider: string; requests: number; cost: number; tokens: number }[];
  byModel:    { model: string;    requests: number; cost: number; tokens: number }[];
  byApiKey:   { apiKeyId: string; requests: number; cost: number }[];
}

// ─── Public API ────────────────────────────────────────────────────────────────

/**
 * Record a new pending request. Called at the start of a chat request.
 * Inserts a row into usage_log and stores metadata in memory for later correlation.
 */
export function trackPendingRequest(
  requestId: string,
  meta: {
    endpoint?: string;
    provider?: string;
    model?: string;
    connectionId?: string;
    apiKeyId?: string;
  }
): void {
  const timestamp = new Date().toISOString();
  db().run(
    `INSERT INTO usage_log (id, timestamp, endpoint, provider, model, connection_id, api_key_id, status)
     VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
    [requestId, timestamp, meta.endpoint ?? null, meta.provider ?? null,
     meta.model ?? null, meta.connectionId ?? null, meta.apiKeyId ?? null]
  );
  pendingRequests.set(requestId, {
    requestId,
    timestamp,
    endpoint: meta.endpoint,
    provider: meta.provider,
    model: meta.model,
    connectionId: meta.connectionId,
    apiKeyId: meta.apiKeyId,
    startTime: Date.now(),
  });
}

/**
 * Called by open-sse after a streaming response completes to save token counts and cost.
 * Looks up the request in the pending map to fill in any missing metadata.
 */
export async function saveRequestUsage(
  requestId: string,
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    reasoning_tokens?: number;
    cached_tokens?: number;
    cost?: number;
    provider?: string;
    model?: string;
  },
  durationMs: number
): Promise<void> {
  const pending = pendingRequests.get(requestId);
  const promptTokens     = usage.prompt_tokens     ?? 0;
  const completionTokens = usage.completion_tokens ?? 0;
  const reasoningTokens  = usage.reasoning_tokens  ?? 0;
  const cachedTokens     = usage.cached_tokens     ?? 0;
  const cost            = usage.cost ?? 0;
  const resolvedProvider = usage.provider ?? pending?.provider;
  const resolvedModel    = usage.model    ?? pending?.model;

  // If open-sse computed a cost, use it; otherwise calculate from pricing if available.
  let finalCost = cost;
  if (finalCost === 0 && resolvedProvider && resolvedModel) {
    finalCost = calculateCost(resolvedProvider, resolvedModel, promptTokens, completionTokens);
  }

  db().run(
    `UPDATE usage_log SET
       prompt_tokens      = ?,
       completion_tokens  = ?,
       reasoning_tokens   = ?,
       cached_tokens       = ?,
       cost                = ?,
       duration_ms         = ?,
       status              = 'ok'
     WHERE id = ? AND status = 'pending'`,
    [promptTokens, completionTokens, reasoningTokens, cachedTokens, finalCost, durationMs, requestId]
  );

  if (pending) {
    pendingRequests.delete(requestId);
  }

  statsEmitter.emit("usage", {
    requestId,
    provider: resolvedProvider,
    model: resolvedModel,
    promptTokens,
    completionTokens,
    cost: finalCost,
    durationMs,
  });
}

/**
 * Update request status (used for errors).
 */
export function appendRequestLog(
  requestId: string,
  status: string,
  _errorMsg?: string
): void {
  db().run(
    `UPDATE usage_log SET status = ? WHERE id = ?`,
    [status, requestId]
  );
  pendingRequests.delete(requestId);
}

/**
 * Optional: save full request/response body (low priority — skip for now).
 */
export function saveRequestDetail(
  _requestId: string,
  _body: unknown
): Promise<void> {
  return Promise.resolve(); // no-op for now
}

// ─── Cost calculation ──────────────────────────────────────────────────────────

// Minimal pricing lookup — reads from KV via the db singleton.
function calculateCost(
  provider: string,
  model: string,
  promptTokens: number,
  completionTokens: number
): number {
  try {
    const row = db()
      .query<{ value: string }, string>("SELECT value FROM kv WHERE key = 'pricing'")
      .get("pricing");
    if (!row) return 0;
    const pricing = JSON.parse(row.value) as Record<
      string,
      Record<string, Record<string, number>>
    >;
    const modelPricing = pricing[provider]?.[model];
    if (!modelPricing) return 0;
    const inputPrice  = modelPricing.input  ?? 0;
    const outputPrice = modelPricing.output ?? 0;
    return (
      (promptTokens     * inputPrice  / 1_000_000) +
      (completionTokens * outputPrice / 1_000_000)
    );
  } catch {
    return 0;
  }
}

// ─── Stats query helpers (used by routes/api/usage/index.ts) ───────────────────

export function getUsageStats(period: string): UsageStats {
  const since = periodToTimestamp(period);
  const where = since ? `WHERE timestamp >= '${since.replace(/'/g, "''")}'` : "";
  const groupByProvider = `SELECT provider, COUNT(*) as requests, SUM(cost) as cost, SUM(prompt_tokens + completion_tokens) as tokens FROM usage_log ${where} AND provider IS NOT NULL GROUP BY provider`;
  const groupByModel    = `SELECT model,    COUNT(*) as requests, SUM(cost) as cost, SUM(prompt_tokens + completion_tokens) as tokens FROM usage_log ${where} AND model    IS NOT NULL GROUP BY model`;
  const groupByApiKey   = `SELECT api_key_id, COUNT(*) as requests, SUM(cost) as cost FROM usage_log ${where} AND api_key_id IS NOT NULL GROUP BY api_key_id`;

  const totals = db()
    .query<{ cnt: number; pt: number; ct: number; c: number }, string>(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(prompt_tokens),0) as pt, COALESCE(SUM(completion_tokens),0) as ct, COALESCE(SUM(cost),0) as c FROM usage_log ${where}`
    )
    .get(where) ?? { cnt: 0, pt: 0, ct: 0, c: 0 };

  return {
    totalRequests:        totals.cnt,
    totalPromptTokens:    totals.pt,
    totalCompletionTokens: totals.ct,
    totalCost:            totals.c,
    byProvider: db().query<{ provider: string; requests: number; cost: number; tokens: number }, []>(groupByProvider).all(),
    byModel:    db().query<{ model: string;    requests: number; cost: number; tokens: number }, []>(groupByModel).all(),
    byApiKey:   db().query<{ api_key_id: string; requests: number; cost: number }, []>(
      groupByApiKey.replace("api_key_id", "api_key_id")
    ).all().map((r: { api_key_id: string; requests: number; cost: number }) => ({
      apiKeyId: r.api_key_id,
      requests: r.requests,
      cost: r.cost,
    })),
  };
}

export function getUsageDetails(opts: {
  page?: number;
  limit?: number;
  provider?: string;
  model?: string;
  period?: string;
}): { rows: UsageRecord[]; total: number } {
  const { page = 1, limit = 50, provider, model, period = "24h" } = opts;
  const since = periodToTimestamp(period);
  const conditions: string[] = [];
  if (since) conditions.push(`timestamp >= '${since.replace(/'/g, "''")}'`);
  if (provider) conditions.push(`provider = '${provider.replace(/'/g, "''")}'`);
  if (model)    conditions.push(`model    = '${model.replace(/'/g, "''")}'`);
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const total = (db()
    .query<{ cnt: number }, string>(`SELECT COUNT(*) as cnt FROM usage_log ${where}`)
    .get(where) ?? { cnt: 0 }).cnt;

  const offset = (page - 1) * limit;
  const rows = db()
    .query<{
      id: string; timestamp: string; endpoint: string; provider: string;
      model: string; connection_id: string; api_key_id: string;
      status: string; prompt_tokens: number; completion_tokens: number;
      reasoning_tokens: number; cached_tokens: number; cost: number; duration_ms: number;
    }, []>(
      `SELECT id, timestamp, endpoint, provider, model, connection_id, api_key_id,
              status, prompt_tokens, completion_tokens, reasoning_tokens, cached_tokens,
              cost, duration_ms
       FROM usage_log ${where}
       ORDER BY timestamp DESC
       LIMIT ${limit} OFFSET ${offset}`
    )
    .all();

  return {
    rows: rows.map(r => ({
      id: r.id,
      timestamp: r.timestamp,
      endpoint: r.endpoint,
      provider: r.provider,
      model: r.model,
      connectionId: r.connection_id,
      apiKeyId: r.api_key_id,
      status: r.status,
      promptTokens: r.prompt_tokens,
      completionTokens: r.completion_tokens,
      reasoningTokens: r.reasoning_tokens,
      cachedTokens: r.cached_tokens,
      cost: r.cost,
      durationMs: r.duration_ms,
    })),
    total,
  };
}
