import { Database } from "bun:sqlite";
import { join } from "node:path";
import { homedir } from "node:os";
import { randomUUID } from "node:crypto";
import { CREATE_TABLES, KV_KEYS, DEFAULT_SETTINGS } from "./schema.ts";

// ─── DB singleton ──────────────────────────────────────────────────────────────

let _db: Database | null = null;

export function openDb(): Database {
  if (_db) return _db;

  const dataDir = process.env.DATA_DIR ?? join(homedir(), ".9router");
  const dbPath = join(dataDir, "router.db");

  _db = new Database(dbPath, { create: true });
  _db.exec("PRAGMA journal_mode = WAL;");
  _db.exec("PRAGMA synchronous = NORMAL;");
  _db.exec(CREATE_TABLES);

  // Clean up expired sessions on startup
  _db.run("DELETE FROM sessions WHERE expires_at < ?", [new Date().toISOString()]);

  // Bootstrap admin user from env vars (only if username doesn't exist yet)
  const adminUsername = process.env.ADMIN_USERNAME;
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (adminUsername && adminPassword) {
    const existing = _db
      .query<{ id: string }, string>("SELECT id FROM users WHERE username = ?")
      .get(adminUsername);
    if (!existing) {
      // Hash synchronously at startup — Bun.password.hashSync uses argon2id
      const hash = Bun.password.hashSync(adminPassword);
      const id = randomUUID();
      _db.run(
        "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
        [id, adminUsername, hash, new Date().toISOString()]
      );
      console.log(`[AUTH] Created admin user: ${adminUsername}`);
    }
  }

  return _db;
}

function db(): Database {
  return _db ?? openDb();
}

// ─── KV helpers ────────────────────────────────────────────────────────────────

function kvGet<T>(key: string, fallback: T): T {
  const row = db().query<{ value: string }, string>("SELECT value FROM kv WHERE key = ?").get(key);
  if (!row) return fallback;
  try {
    return JSON.parse(row.value) as T;
  } catch {
    return fallback;
  }
}

function kvSet(key: string, value: unknown): void {
  db().run(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, JSON.stringify(value)]
  );
}

// ─── Provider Connections ──────────────────────────────────────────────────────

export interface ProviderConnection {
  id: string;
  provider: string;
  [key: string]: unknown;
}

export async function getProviderConnections(filter: { provider?: string; isActive?: boolean } = {}): Promise<ProviderConnection[]> {
  let rows: { id: string; provider: string; data: string }[];

  if (filter.provider) {
    rows = db()
      .query<{ id: string; provider: string; data: string }, string>(
        "SELECT id, provider, data FROM provider_connections WHERE provider = ?"
      )
      .all(filter.provider);
  } else {
    rows = db()
      .query<{ id: string; provider: string; data: string }, []>(
        "SELECT id, provider, data FROM provider_connections"
      )
      .all();
  }

  let connections: ProviderConnection[] = rows.map(r => ({
    id: r.id,
    provider: r.provider,
    ...(JSON.parse(r.data) as Record<string, unknown>),
  }));

  if (filter.isActive !== undefined) {
    connections = connections.filter(c => c.isActive === filter.isActive);
  }

  connections.sort((a, b) => ((a.priority as number) || 999) - ((b.priority as number) || 999));
  return connections;
}

export async function getProviderConnectionById(id: string): Promise<ProviderConnection | null> {
  const row = db()
    .query<{ id: string; provider: string; data: string }, string>(
      "SELECT id, provider, data FROM provider_connections WHERE id = ?"
    )
    .get(id);
  if (!row) return null;
  return { id: row.id, provider: row.provider, ...(JSON.parse(row.data) as Record<string, unknown>) };
}

export async function createProviderConnection(data: Record<string, unknown>): Promise<ProviderConnection> {
  const id = (data.id as string) ?? randomUUID();
  const provider = data.provider as string;
  const now = new Date().toISOString();
  const conn = { ...data, id, provider, createdAt: now, updatedAt: now };
  db().run(
    "INSERT INTO provider_connections (id, provider, data) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    [id, provider, JSON.stringify(conn)]
  );
  return conn as ProviderConnection;
}

export async function updateProviderConnection(id: string, data: Record<string, unknown>): Promise<ProviderConnection | null> {
  const existing = await getProviderConnectionById(id);
  if (!existing) return null;

  // Handle null values as deletions (clear the field)
  const merged: Record<string, unknown> = { ...existing };
  for (const [k, v] of Object.entries(data)) {
    if (v === null) {
      delete merged[k];
    } else {
      merged[k] = v;
    }
  }
  merged.updatedAt = new Date().toISOString();

  db().run(
    "UPDATE provider_connections SET data = ? WHERE id = ?",
    [JSON.stringify(merged), id]
  );
  return merged as ProviderConnection;
}

export async function deleteProviderConnection(id: string): Promise<boolean> {
  const result = db().run("DELETE FROM provider_connections WHERE id = ?", [id]);
  return (result.changes ?? 0) > 0;
}

export async function deleteProviderConnectionsByProvider(providerId: string): Promise<number> {
  const result = db().run("DELETE FROM provider_connections WHERE provider = ?", [providerId]);
  return result.changes ?? 0;
}

export async function reorderProviderConnections(_providerId: string): Promise<void> {
  // SQLite handles concurrent access; no reordering needed for bun runtime
}

// ─── Provider Nodes ────────────────────────────────────────────────────────────

export interface ProviderNode {
  id: string;
  type?: string;
  name?: string;
  prefix?: string;
  apiType?: string;
  baseUrl?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
}

export async function getProviderNodes(filter: { type?: string } = {}): Promise<ProviderNode[]> {
  let rows: ProviderNode[];
  if (filter.type) {
    rows = db()
      .query<ProviderNode, string>(
        "SELECT id, type, name, prefix, api_type as apiType, base_url as baseUrl, created_at as createdAt, updated_at as updatedAt FROM provider_nodes WHERE type = ?"
      )
      .all(filter.type);
  } else {
    rows = db()
      .query<ProviderNode, []>(
        "SELECT id, type, name, prefix, api_type as apiType, base_url as baseUrl, created_at as createdAt, updated_at as updatedAt FROM provider_nodes"
      )
      .all();
  }
  return rows;
}

export async function getProviderNodeById(id: string): Promise<ProviderNode | null> {
  return db()
    .query<ProviderNode, string>(
      "SELECT id, type, name, prefix, api_type as apiType, base_url as baseUrl, created_at as createdAt, updated_at as updatedAt FROM provider_nodes WHERE id = ?"
    )
    .get(id) ?? null;
}

export async function createProviderNode(data: Record<string, unknown>): Promise<ProviderNode> {
  const id = (data.id as string) ?? randomUUID();
  const now = new Date().toISOString();
  db().run(
    "INSERT INTO provider_nodes (id, type, name, prefix, api_type, base_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [id, data.type as string ?? null, data.name as string ?? null, data.prefix as string ?? null, data.apiType as string ?? null, data.baseUrl as string ?? null, now, now]
  );
  return { id, ...(data as Record<string, unknown>), createdAt: now, updatedAt: now } as ProviderNode;
}

export async function updateProviderNode(id: string, data: Record<string, unknown>): Promise<ProviderNode | null> {
  const now = new Date().toISOString();
  db().run(
    "UPDATE provider_nodes SET type = COALESCE(?, type), name = COALESCE(?, name), prefix = COALESCE(?, prefix), api_type = COALESCE(?, api_type), base_url = COALESCE(?, base_url), updated_at = ? WHERE id = ?",
    [data.type as string ?? null, data.name as string ?? null, data.prefix as string ?? null, data.apiType as string ?? null, data.baseUrl as string ?? null, now, id]
  );
  return getProviderNodeById(id);
}

export async function deleteProviderNode(id: string): Promise<boolean> {
  const result = db().run("DELETE FROM provider_nodes WHERE id = ?", [id]);
  return (result.changes ?? 0) > 0;
}

// ─── Proxy Pools ───────────────────────────────────────────────────────────────

export interface ProxyPool {
  id: string;
  name?: string;
  proxyUrl?: string;
  noProxy?: string;
  isActive?: boolean;
  strictProxy?: boolean;
  testStatus?: string;
  lastTestedAt?: string;
  lastError?: string;
  [key: string]: unknown;
}

export async function getProxyPools(filter: { isActive?: boolean; testStatus?: string } = {}): Promise<ProxyPool[]> {
  const rows = db()
    .query<{ id: string; data: string }, []>("SELECT id, data FROM proxy_pools")
    .all();

  let pools: ProxyPool[] = rows.map(r => ({ id: r.id, ...(JSON.parse(r.data) as Record<string, unknown>) } as ProxyPool));

  if (filter.isActive !== undefined) pools = pools.filter(p => p.isActive === filter.isActive);
  if (filter.testStatus) pools = pools.filter(p => p.testStatus === filter.testStatus);

  return pools.sort((a, b) => new Date((b.updatedAt as string) || 0).getTime() - new Date((a.updatedAt as string) || 0).getTime());
}

export async function getProxyPoolById(id: string): Promise<ProxyPool | null> {
  const row = db()
    .query<{ id: string; data: string }, string>("SELECT id, data FROM proxy_pools WHERE id = ?")
    .get(id);
  if (!row) return null;
  return { id: row.id, ...(JSON.parse(row.data) as Record<string, unknown>) } as ProxyPool;
}

export async function createProxyPool(data: Record<string, unknown>): Promise<ProxyPool> {
  const id = (data.id as string) ?? randomUUID();
  const pool = { ...data, id };
  db().run(
    "INSERT INTO proxy_pools (id, data) VALUES (?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data",
    [id, JSON.stringify(pool)]
  );
  return pool as ProxyPool;
}

export async function updateProxyPool(id: string, data: Record<string, unknown>): Promise<ProxyPool | null> {
  const existing = await getProxyPoolById(id);
  if (!existing) return null;
  const merged = { ...existing, ...data, id };
  db().run("UPDATE proxy_pools SET data = ? WHERE id = ?", [JSON.stringify(merged), id]);
  return merged as ProxyPool;
}

export async function deleteProxyPool(id: string): Promise<boolean> {
  const result = db().run("DELETE FROM proxy_pools WHERE id = ?", [id]);
  return (result.changes ?? 0) > 0;
}

// ─── Combos ────────────────────────────────────────────────────────────────────

export interface Combo {
  id: string;
  name: string;
  models: string[];
  createdAt?: string;
  updatedAt?: string;
}

export async function getCombos(): Promise<Combo[]> {
  return db()
    .query<{ id: string; name: string; models: string; created_at: string; updated_at: string }, []>(
      "SELECT id, name, models, created_at, updated_at FROM combos"
    )
    .all()
    .map(r => ({
      id: r.id,
      name: r.name,
      models: JSON.parse(r.models) as string[],
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    }));
}

export async function getComboById(id: string): Promise<Combo | null> {
  const row = db()
    .query<{ id: string; name: string; models: string; created_at: string; updated_at: string }, string>(
      "SELECT id, name, models, created_at, updated_at FROM combos WHERE id = ?"
    )
    .get(id);
  if (!row) return null;
  return { id: row.id, name: row.name, models: JSON.parse(row.models) as string[], createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function getComboByName(name: string): Promise<Combo | null> {
  const row = db()
    .query<{ id: string; name: string; models: string; created_at: string; updated_at: string }, string>(
      "SELECT id, name, models, created_at, updated_at FROM combos WHERE name = ?"
    )
    .get(name);
  if (!row) return null;
  return { id: row.id, name: row.name, models: JSON.parse(row.models) as string[], createdAt: row.created_at, updatedAt: row.updated_at };
}

export async function createCombo(data: { name: string; models?: string[] }): Promise<Combo> {
  const id = randomUUID();
  const now = new Date().toISOString();
  db().run(
    "INSERT INTO combos (id, name, models, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    [id, data.name, JSON.stringify(data.models ?? []), now, now]
  );
  return { id, name: data.name, models: data.models ?? [], createdAt: now, updatedAt: now };
}

export async function updateCombo(id: string, data: Partial<Combo>): Promise<Combo | null> {
  const now = new Date().toISOString();
  if (data.models !== undefined) {
    db().run(
      "UPDATE combos SET name = COALESCE(?, name), models = ?, updated_at = ? WHERE id = ?",
      [data.name ?? null, JSON.stringify(data.models), now, id]
    );
  } else if (data.name) {
    db().run("UPDATE combos SET name = ?, updated_at = ? WHERE id = ?", [data.name, now, id]);
  }
  return getComboById(id);
}

export async function deleteCombo(id: string): Promise<boolean> {
  const result = db().run("DELETE FROM combos WHERE id = ?", [id]);
  return (result.changes ?? 0) > 0;
}

// ─── API Keys ──────────────────────────────────────────────────────────────────

export interface ApiKey {
  id: string;
  name?: string;
  key?: string;
  machineId?: string;
  isActive?: boolean;
  createdAt?: string;
}

export async function getApiKeys(): Promise<ApiKey[]> {
  return db()
    .query<{ id: string; name: string; key: string; machine_id: string; is_active: number; created_at: string }, []>(
      "SELECT id, name, key, machine_id, is_active, created_at FROM api_keys"
    )
    .all()
    .map(r => ({ id: r.id, name: r.name, key: r.key, machineId: r.machine_id, isActive: r.is_active === 1, createdAt: r.created_at }));
}

export async function validateApiKey(key: string): Promise<boolean> {
  const row = db()
    .query<{ is_active: number }, string>("SELECT is_active FROM api_keys WHERE key = ?")
    .get(key);
  return row !== null && row.is_active === 1;
}

export async function getApiKeyByKey(key: string): Promise<ApiKey | null> {
  const row = db()
    .query<{ id: string; name: string; key: string; machine_id: string; is_active: number; created_at: string }, string>(
      "SELECT id, name, key, machine_id, is_active, created_at FROM api_keys WHERE key = ?"
    )
    .get(key);
  if (!row) return null;
  return { id: row.id, name: row.name, key: row.key, machineId: row.machine_id, isActive: row.is_active === 1, createdAt: row.created_at };
}

export async function getApiKeyById(id: string): Promise<ApiKey | null> {
  const row = db()
    .query<{ id: string; name: string; key: string; machine_id: string; is_active: number; created_at: string }, string>(
      "SELECT id, name, key, machine_id, is_active, created_at FROM api_keys WHERE id = ?"
    )
    .get(id);
  if (!row) return null;
  return { id: row.id, name: row.name, key: row.key, machineId: row.machine_id, isActive: row.is_active === 1, createdAt: row.created_at };
}

export async function createApiKey(name: string, _machineId?: string): Promise<ApiKey> {
  const id = randomUUID();
  const key = `sk-${randomUUID().replace(/-/g, "")}`;
  const now = new Date().toISOString();
  db().run(
    "INSERT INTO api_keys (id, name, key, machine_id, is_active, created_at) VALUES (?, ?, ?, ?, 1, ?)",
    [id, name, key, _machineId ?? null, now]
  );
  return { id, name, key, machineId: _machineId, isActive: true, createdAt: now };
}

export async function updateApiKey(id: string, data: Partial<ApiKey>): Promise<ApiKey | null> {
  const updates: string[] = [];
  const params: (string | number | null)[] = [];
  if (data.name !== undefined) { updates.push("name = ?"); params.push(data.name); }
  if (data.isActive !== undefined) { updates.push("is_active = ?"); params.push(data.isActive ? 1 : 0); }
  if (updates.length === 0) return getApiKeyById(id);
  params.push(id);
  db().run(`UPDATE api_keys SET ${updates.join(", ")} WHERE id = ?`, params);
  return getApiKeyById(id);
}

export async function deleteApiKey(id: string): Promise<boolean> {
  const result = db().run("DELETE FROM api_keys WHERE id = ?", [id]);
  return (result.changes ?? 0) > 0;
}

// ─── Users ────────────────────────────────────────────────────────────────────

export interface User {
  id: string;
  username: string;
  passwordHash: string;
  createdAt?: string;
}

export async function createUser(username: string, passwordHash: string): Promise<User> {
  const id = randomUUID();
  const now = new Date().toISOString();
  db().run(
    "INSERT INTO users (id, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
    [id, username, passwordHash, now]
  );
  return { id, username, passwordHash, createdAt: now };
}

export async function getUserByUsername(username: string): Promise<User | null> {
  const row = db()
    .query<{ id: string; username: string; password_hash: string; created_at: string }, string>(
      "SELECT id, username, password_hash, created_at FROM users WHERE username = ?"
    )
    .get(username);
  if (!row) return null;
  return { id: row.id, username: row.username, passwordHash: row.password_hash, createdAt: row.created_at };
}

export async function getUserById(id: string): Promise<User | null> {
  const row = db()
    .query<{ id: string; username: string; password_hash: string; created_at: string }, string>(
      "SELECT id, username, password_hash, created_at FROM users WHERE id = ?"
    )
    .get(id);
  if (!row) return null;
  return { id: row.id, username: row.username, passwordHash: row.password_hash, createdAt: row.created_at };
}

// ─── Sessions ──────────────────────────────────────────────────────────────────

const SESSION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export async function createSession(userId: string): Promise<{ token: string; expiresAt: string }> {
  const token = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + SESSION_TTL_MS).toISOString();
  db().run(
    "INSERT INTO sessions (token, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    [token, userId, expiresAt, now.toISOString()]
  );
  return { token, expiresAt };
}

export async function getSessionByToken(token: string): Promise<{ userId: string; expiresAt: string } | null> {
  const row = db()
    .query<{ user_id: string; expires_at: string }, string>(
      "SELECT user_id, expires_at FROM sessions WHERE token = ?"
    )
    .get(token);
  if (!row) return null;
  if (new Date(row.expires_at) < new Date()) {
    db().run("DELETE FROM sessions WHERE token = ?", [token]);
    return null;
  }
  return { userId: row.user_id, expiresAt: row.expires_at };
}

export async function deleteSession(token: string): Promise<void> {
  db().run("DELETE FROM sessions WHERE token = ?", [token]);
}

export async function deleteExpiredSessions(): Promise<void> {
  db().run("DELETE FROM sessions WHERE expires_at < ?", [new Date().toISOString()]);
}

// ─── Model Aliases ─────────────────────────────────────────────────────────────

export async function getModelAliases(): Promise<Record<string, string>> {
  return kvGet<Record<string, string>>(KV_KEYS.MODEL_ALIASES, {});
}

export async function setModelAlias(alias: string, model: string): Promise<void> {
  const aliases = await getModelAliases();
  aliases[alias] = model;
  kvSet(KV_KEYS.MODEL_ALIASES, aliases);
}

export async function deleteModelAlias(alias: string): Promise<void> {
  const aliases = await getModelAliases();
  delete aliases[alias];
  kvSet(KV_KEYS.MODEL_ALIASES, aliases);
}

// ─── MITM Alias ────────────────────────────────────────────────────────────────

export async function getMitmAlias(toolName?: string): Promise<Record<string, unknown>> {
  const all = kvGet<Record<string, unknown>>(KV_KEYS.MITM_ALIAS, {});
  if (toolName) return (all[toolName] as Record<string, unknown>) ?? {};
  return all;
}

export async function setMitmAliasAll(toolName: string, mappings: Record<string, unknown>): Promise<void> {
  const all = await getMitmAlias();
  all[toolName] = mappings ?? {};
  kvSet(KV_KEYS.MITM_ALIAS, all);
}

// ─── Settings ──────────────────────────────────────────────────────────────────

export async function getSettings(): Promise<typeof DEFAULT_SETTINGS & Record<string, unknown>> {
  const stored = kvGet<Record<string, unknown>>(KV_KEYS.SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...stored } as typeof DEFAULT_SETTINGS & Record<string, unknown>;
}

export async function updateSettings(updates: Record<string, unknown>): Promise<Record<string, unknown>> {
  const current = await getSettings();
  const next = { ...current, ...updates };
  kvSet(KV_KEYS.SETTINGS, next);
  return next;
}

// ─── Pricing ───────────────────────────────────────────────────────────────────

export async function getPricingForModel(provider: string, model: string): Promise<Record<string, number> | null> {
  const userPricing = kvGet<Record<string, Record<string, Record<string, number>>>>(KV_KEYS.PRICING, {});
  return userPricing[provider]?.[model] ?? null;
}

export async function getPricing(): Promise<Record<string, Record<string, Record<string, number>>>> {
  return kvGet(KV_KEYS.PRICING, {});
}

export async function updatePricing(pricingData: Record<string, Record<string, Record<string, number>>>): Promise<void> {
  const current = await getPricing();
  for (const [provider, models] of Object.entries(pricingData)) {
    if (!current[provider]) current[provider] = {};
    for (const [model, pricing] of Object.entries(models)) {
      current[provider]![model] = pricing;
    }
  }
  kvSet(KV_KEYS.PRICING, current);
}

// ─── Export / Import ───────────────────────────────────────────────────────────

export async function exportDb(): Promise<Record<string, unknown>> {
  const [connections, nodes, pools, combos, keys, settings, aliases] = await Promise.all([
    getProviderConnections(),
    getProviderNodes(),
    getProxyPools(),
    getCombos(),
    getApiKeys(),
    getSettings(),
    getModelAliases(),
  ]);
  return {
    providerConnections: connections,
    providerNodes: nodes,
    proxyPools: pools,
    combos,
    apiKeys: keys,
    settings,
    modelAliases: aliases,
  };
}

export async function isCloudEnabled(): Promise<boolean> {
  const settings = await getSettings();
  return settings.cloudEnabled === true;
}

export async function getCloudUrl(): Promise<string> {
  const settings = await getSettings();
  return (settings as Record<string, unknown>).cloudUrl as string
    ?? process.env.CLOUD_URL
    ?? "";
}

export async function cleanupProviderConnections(): Promise<number> {
  return 0; // SQLite JSON blob approach doesn't accumulate null fields
}
