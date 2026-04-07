// SQLite schema for bun-runtime
// provider_connections uses a JSON blob for all flexible fields (modelLock_*, providerSpecificData, etc.)

export const CREATE_TABLES = `
  CREATE TABLE IF NOT EXISTS provider_connections (
    id       TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    data     TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_pc_provider ON provider_connections(provider);

  CREATE TABLE IF NOT EXISTS provider_nodes (
    id         TEXT PRIMARY KEY,
    type       TEXT,
    name       TEXT,
    prefix     TEXT,
    api_type   TEXT,
    base_url   TEXT,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS proxy_pools (
    id   TEXT PRIMARY KEY,
    data TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS combos (
    id         TEXT PRIMARY KEY,
    name       TEXT UNIQUE NOT NULL,
    models     TEXT NOT NULL,
    created_at TEXT,
    updated_at TEXT
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    id         TEXT PRIMARY KEY,
    name       TEXT,
    key        TEXT UNIQUE,
    machine_id TEXT,
    is_active  INTEGER DEFAULT 1,
    created_at TEXT
  );

  CREATE TABLE IF NOT EXISTS kv (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    username      TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    created_at    TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    created_at TEXT
  );
`;

// kv keys used
export const KV_KEYS = {
  SETTINGS:      "settings",
  MODEL_ALIASES: "model_aliases",
  MITM_ALIAS:    "mitm_alias",
  PRICING:       "pricing",
} as const;

export const DEFAULT_SETTINGS = {
  cloudEnabled: false,
  tunnelEnabled: false,
  tunnelUrl: "",
  stickyRoundRobinLimit: 3,
  providerStrategies: {},
  comboStrategy: "fallback",
  comboStrategies: {},
  requireLogin: true,
  requireApiKey: false,
  observabilityEnabled: true,
  observabilityMaxRecords: 1000,
  observabilityBatchSize: 20,
  observabilityFlushIntervalMs: 5000,
  observabilityMaxJsonSize: 1024,
  outboundProxyEnabled: false,
  outboundProxyUrl: "",
  outboundNoProxy: "",
  mitmRouterBaseUrl: "http://localhost:20128",
  ccFilterNaming: false,
  fallbackStrategy: "fill-first",
};
