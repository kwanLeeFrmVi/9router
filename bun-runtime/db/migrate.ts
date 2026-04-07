/**
 * Migration: ~/.9router/db.json → SQLite (router.db)
 * Idempotent: skips if provider_connections already has data.
 * Run: bun db/migrate.ts
 */
import { join } from "node:path";
import { homedir } from "node:os";
import {
  openDb,
  createProviderConnection,
  createProviderNode,
  createProxyPool,
  createCombo,
} from "./index.ts";
import { KV_KEYS } from "./schema.ts";

const dataDir = process.env.DATA_DIR ?? join(homedir(), ".9router");
const dbJsonPath = join(dataDir, "db.json");

const db = openDb();

// Check if already migrated
const count = db.query<{ count: number }, []>("SELECT COUNT(*) as count FROM provider_connections").get();
if ((count?.count ?? 0) > 0) {
  console.log("[migrate] SQLite already populated, skipping.");
  process.exit(0);
}

// Read db.json
const file = Bun.file(dbJsonPath);
if (!(await file.exists())) {
  console.log(`[migrate] No db.json found at ${dbJsonPath}, nothing to migrate.`);
  process.exit(0);
}

const data = await file.json() as Record<string, unknown>;
console.log(`[migrate] Reading ${dbJsonPath}`);

// Migrate provider connections
const connections = (data.providerConnections as Record<string, unknown>[]) ?? [];
for (const conn of connections) {
  await createProviderConnection(conn);
}
console.log(`[migrate] Migrated ${connections.length} provider connections`);

// Migrate provider nodes
const nodes = (data.providerNodes as Record<string, unknown>[]) ?? [];
for (const node of nodes) {
  await createProviderNode({
    id: node.id as string,
    type: node.type as string,
    name: node.name as string,
    prefix: node.prefix as string,
    apiType: (node.apiType ?? node.type) as string,
    baseUrl: node.baseUrl as string,
  });
}
console.log(`[migrate] Migrated ${nodes.length} provider nodes`);

// Migrate proxy pools
const pools = (data.proxyPools as Record<string, unknown>[]) ?? [];
for (const pool of pools) {
  await createProxyPool(pool);
}
console.log(`[migrate] Migrated ${pools.length} proxy pools`);

// Migrate combos
const combos = (data.combos as Array<{ name: string; models: string[] }>) ?? [];
for (const combo of combos) {
  await createCombo({ name: combo.name, models: combo.models ?? [] });
}
console.log(`[migrate] Migrated ${combos.length} combos`);

// Migrate API keys
const apiKeys = (data.apiKeys as Array<{ id: string; name: string; key: string; machineId?: string; isActive?: boolean; createdAt?: string }>) ?? [];
for (const k of apiKeys) {
  db.run(
    "INSERT OR IGNORE INTO api_keys (id, name, key, machine_id, is_active, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    [k.id, k.name, k.key, k.machineId ?? null, k.isActive !== false ? 1 : 0, k.createdAt ?? new Date().toISOString()]
  );
}
console.log(`[migrate] Migrated ${apiKeys.length} API keys`);

// Migrate KV: settings, modelAliases, mitmAlias, pricing
const kv: Array<[string, unknown]> = [
  [KV_KEYS.SETTINGS,      data.settings      ?? {}],
  [KV_KEYS.MODEL_ALIASES, data.modelAliases   ?? {}],
  [KV_KEYS.MITM_ALIAS,    data.mitmAlias      ?? {}],
  [KV_KEYS.PRICING,       data.pricing        ?? {}],
];
for (const [key, value] of kv) {
  db.run(
    "INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, JSON.stringify(value)]
  );
}
console.log("[migrate] Migrated settings, model aliases, mitm aliases, pricing");

console.log("[migrate] Done.");
