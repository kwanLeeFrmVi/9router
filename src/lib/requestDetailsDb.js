import path from "path";
import os from "os";
import fs from "fs";

const isCloud = typeof caches !== "undefined" && typeof caches === "object";

const DEFAULT_MAX_RECORDS = 200;
const DEFAULT_BATCH_SIZE = 20;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_JSON_SIZE = 5 * 1024; // 5KB default, configurable via settings
const CONFIG_CACHE_TTL_MS = 5000;

function getAppName() {
  return "9router";
}

function getUserDataDir() {
  if (isCloud) return "/tmp";
  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  const platform = process.platform;
  const homeDir = os.homedir();
  const appName = getAppName();

  if (platform === "win32") {
    return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
  }
  return path.join(homeDir, `.${appName}`);
}

const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "request-details.json");

if (!isCloud && !fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

let dbInstance = null;

async function getDb() {
  if (isCloud) return null;
  if (!dbInstance) {
    const adapter = new JSONFile(DB_FILE);
    const db = new Low(adapter, { records: [] });
    await db.read();
    if (!db.data?.records) db.data = { records: [] };
    dbInstance = db;
  }
  return dbInstance;
}

// Config cache
let cachedConfig = null;
let cachedConfigTs = 0;

async function getObservabilityConfig() {
  if (cachedConfig && (Date.now() - cachedConfigTs) < CONFIG_CACHE_TTL_MS) {
    return cachedConfig;
  }

  try {
    const { getSettings } = await import("@/lib/localDb");
    const settings = await getSettings();
    const envEnabled = process.env.OBSERVABILITY_ENABLED !== "false";
    const enabled = typeof settings.observabilityEnabled === "boolean"
      ? settings.observabilityEnabled
      : envEnabled;

    cachedConfig = {
      enabled,
      maxRecords: settings.observabilityMaxRecords || parseInt(process.env.OBSERVABILITY_MAX_RECORDS || String(DEFAULT_MAX_RECORDS), 10),
      batchSize: settings.observabilityBatchSize || parseInt(process.env.OBSERVABILITY_BATCH_SIZE || String(DEFAULT_BATCH_SIZE), 10),
      flushIntervalMs: settings.observabilityFlushIntervalMs || parseInt(process.env.OBSERVABILITY_FLUSH_INTERVAL_MS || String(DEFAULT_FLUSH_INTERVAL_MS), 10),
      maxJsonSize: (settings.observabilityMaxJsonSize || parseInt(process.env.OBSERVABILITY_MAX_JSON_SIZE || "5", 10)) * 1024,
    };
  } catch {
    cachedConfig = {
      enabled: true,
      maxRecords: DEFAULT_MAX_RECORDS,
      batchSize: DEFAULT_BATCH_SIZE,
      flushIntervalMs: DEFAULT_FLUSH_INTERVAL_MS,
      maxJsonSize: DEFAULT_MAX_JSON_SIZE,
    };
  }

  cachedConfigTs = Date.now();
  return cachedConfig;
}

let dbInstance = null;
let DatabaseCtor = null;

async function getDatabaseCtor() {
  if (DatabaseCtor) return DatabaseCtor;

  if (typeof Bun !== "undefined") {
    const bunSqlite = await (new Function("return import('bun:sqlite')")());
    DatabaseCtor = bunSqlite.Database;
    return DatabaseCtor;
  }

  const betterSqlite3 = await import("better-sqlite3");
  DatabaseCtor = betterSqlite3.default;
  return DatabaseCtor;
}

function prepareStatement(db, sql) {
  if (typeof db.prepare === "function") return db.prepare(sql);
  if (typeof db.query === "function") return db.query(sql);
  throw new Error("Unsupported SQLite client: missing prepare/query");
}

function applyPragmas(db) {
  if (typeof db.pragma === "function") {
    db.pragma("journal_mode = WAL");
    db.pragma("synchronous = NORMAL");
    db.pragma("cache_size = -64000");
    db.pragma("temp_store = MEMORY");
    return;
  }

  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA synchronous = NORMAL;");
  db.exec("PRAGMA cache_size = -64000;");
  db.exec("PRAGMA temp_store = MEMORY;");
}


// Get app name
function getAppName() {
  return "9router";
}

// Get user data directory based on platform
function getUserDataDir() {
  if (isCloud) return "/tmp";

  if (process.env.DATA_DIR) return process.env.DATA_DIR;

  try {
    const platform = process.platform;
    const homeDir = os.homedir();
    const appName = getAppName();

    if (platform === "win32") {
      return path.join(process.env.APPDATA || path.join(homeDir, "AppData", "Roaming"), appName);
    } else {
      return path.join(homeDir, `.${appName}`);
    }
  } catch (error) {
    console.error("[requestDetailsDb] Failed to get user data directory:", error.message);
    return path.join(process.cwd(), ".9router");
  }
}

// Database file path
const DATA_DIR = getUserDataDir();
const DB_FILE = isCloud ? null : path.join(DATA_DIR, "request-details.sqlite");

// Ensure data directory exists
if (!isCloud && fs && typeof fs.existsSync === "function") {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      fs.mkdirSync(DATA_DIR, { recursive: true });
    }
  } catch (error) {
    console.error("[requestDetailsDb] Failed to create data directory:", error.message);
  }
}

// ============================================================================
// BATCH WRITE QUEUE
// ============================================================================

/**
 * In-memory buffer for batch writes.
 * Accumulates request details before flushing to database in a transaction.
 * @type {Array<object>}
 */
let writeBuffer = [];
let flushTimer = null;
let isFlushing = false;

function safeJsonStringify(obj, maxSize) {
  try {
    const str = JSON.stringify(obj);
    if (str.length > maxSize) {
      return JSON.stringify({ _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) });
    }
    return str;
  } catch {
    return "{}";
  }

  if (!dbInstance) {
    const DbCtor = await getDatabaseCtor();
    const db = new DbCtor(DB_FILE);

    // Configure for better concurrency
    applyPragmas(db);

    // Create table with indexes
    db.exec(`
      CREATE TABLE IF NOT EXISTS request_details (
        id TEXT PRIMARY KEY,
        provider TEXT,
        model TEXT,
        connection_id TEXT,
        timestamp INTEGER NOT NULL,
        status TEXT,
        latency TEXT,
        tokens TEXT,
        request TEXT,
        provider_request TEXT,
        provider_response TEXT,
        response TEXT
      );

      -- Indexes for common queries
      CREATE INDEX IF NOT EXISTS idx_timestamp
        ON request_details(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_provider
        ON request_details(provider);
      CREATE INDEX IF NOT EXISTS idx_model
        ON request_details(model);
      CREATE INDEX IF NOT EXISTS idx_connection
        ON request_details(connection_id);
      CREATE INDEX IF NOT EXISTS idx_status
        ON request_details(status);
    `);

    dbInstance = db;

    // Register shutdown handler on first database initialization
    ensureShutdownHandler();
  }

  return dbInstance;
}

function sanitizeHeaders(headers) {
  if (!headers || typeof headers !== "object") return {};
  const sensitiveKeys = ["authorization", "x-api-key", "cookie", "token", "api-key"];
  const sanitized = { ...headers };
  for (const key of Object.keys(sanitized)) {
    if (sensitiveKeys.some(s => key.toLowerCase().includes(s))) {
      delete sanitized[key];
    }
  }
  return sanitized;
}

function generateDetailId(model) {
  const timestamp = new Date().toISOString();
  const random = Math.random().toString(36).substring(2, 8);
  const modelPart = model ? model.replace(/[^a-zA-Z0-9-]/g, "-") : "unknown";
  return `${timestamp}-${random}-${modelPart}`;
}

async function flushToDatabase() {
  if (isCloud || isFlushing || writeBuffer.length === 0) return;

  isFlushing = true;
  try {
    const itemsToSave = [...writeBuffer];
    writeBuffer = [];

    const db = await getDb();
    const config = await getObservabilityConfig();

    // Prepare statements outside transaction for better performance
    const insertStmt = prepareStatement(db, `
      INSERT OR REPLACE INTO request_details
      (id, provider, model, connection_id, timestamp, status, latency, tokens,
       request, provider_request, provider_response, response)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const deleteStmt = prepareStatement(db, `
      DELETE FROM request_details
      WHERE id NOT IN (
        SELECT id FROM request_details
        ORDER BY timestamp DESC
        LIMIT ?
      )
    `);

    // Truncate oversized JSON fields
    const maxSize = config.maxJsonSize;
    for (const field of ["request", "providerRequest", "providerResponse", "response"]) {
      const str = JSON.stringify(record[field]);
      if (str.length > maxSize) {
        record[field] = { _truncated: true, _originalSize: str.length, _preview: str.substring(0, 200) };
      }
    }

    // Upsert: replace existing record with same id
    const idx = db.data.records.findIndex(r => r.id === record.id);
    if (idx !== -1) {
      db.data.records[idx] = record;
    } else {
      db.data.records.push(record);
    }
  }

    // Keep only latest maxRecords (sorted by timestamp desc)
    db.data.records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));
  if (db.data.records.length > config.maxRecords) {
    db.data.records = db.data.records.slice(0, config.maxRecords);
  }

  await db.write();
} catch (error) {
  console.error("[requestDetailsDb] Batch write failed:", error);
} finally {
  isFlushing = false;
}
}

export async function saveRequestDetail(detail) {
  if (isCloud) return;

  const config = await getObservabilityConfig();
  if (!config.enabled) return;

  writeBuffer.push(detail);

  if (writeBuffer.length >= config.batchSize) {
    await flushToDatabase();
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  } else if (!flushTimer) {
    flushTimer = setTimeout(() => {
      flushToDatabase().catch(() => { });
      flushTimer = null;
    }, config.flushIntervalMs);
  }
}

export async function getRequestDetails(filter = {}) {
  if (isCloud) {
    return { details: [], pagination: { page: 1, pageSize: 50, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }

  const db = await getDb();
  let records = [...db.data.records];

  // Apply filters
  if (filter.provider) records = records.filter(r => r.provider === filter.provider);
  if (filter.model) records = records.filter(r => r.model === filter.model);
  if (filter.connectionId) records = records.filter(r => r.connectionId === filter.connectionId);
  if (filter.status) records = records.filter(r => r.status === filter.status);
  if (filter.startDate) records = records.filter(r => new Date(r.timestamp) >= new Date(filter.startDate));
  if (filter.endDate) records = records.filter(r => new Date(r.timestamp) <= new Date(filter.endDate));

  // Sort desc
  records.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp));

  const totalItems = records.length;
  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  const totalPages = Math.ceil(totalItems / pageSize);
  const details = records.slice((page - 1) * pageSize, page * pageSize);

  return {
    details,
    pagination: { page, pageSize, totalItems, totalPages, hasNext: page < totalPages, hasPrev: page > 1 },
  };
}

export async function getRequestDetailById(id) {
  if (isCloud) return null;

  const db = await getDb();
  return db.data.records.find(r => r.id === id) || null;
}

// Graceful shutdown
let shutdownHandlerRegistered = false;

function ensureShutdownHandler() {
  if (shutdownHandlerRegistered || isCloud) return;

  const handler = async () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
    if (writeBuffer.length > 0) await flushToDatabase();
  };

  process.on("beforeExit", handler);
  process.on("SIGINT", handler);
  process.on("SIGTERM", handler);
  process.on("exit", handler);

  shutdownHandlerRegistered = true;
}

/**
 * Get request details with filtering and pagination
 * @param {object} filter - Filter options
 * @returns {Promise<object>} Details with pagination info
 */
export async function getRequestDetails(filter = {}) {
  const db = await getRequestDetailsDb();

  if (isCloud) {
    return { details: [], pagination: { page: 1, pageSize: filter.pageSize || 50, totalItems: 0, totalPages: 0, hasNext: false, hasPrev: false } };
  }

  let query = 'SELECT * FROM request_details WHERE 1=1';
  const params = [];

  if (filter.provider) {
    query += ' AND provider = ?';
    params.push(filter.provider);
  }

  if (filter.model) {
    query += ' AND model = ?';
    params.push(filter.model);
  }

  if (filter.connectionId) {
    query += ' AND connection_id = ?';
    params.push(filter.connectionId);
  }

  if (filter.status) {
    query += ' AND status = ?';
    params.push(filter.status);
  }

  if (filter.startDate) {
    query += ' AND timestamp >= ?';
    params.push(new Date(filter.startDate).getTime());
  }

  if (filter.endDate) {
    query += ' AND timestamp <= ?';
    params.push(new Date(filter.endDate).getTime());
  }

  // Get total count first
  const countQuery = query.replace('SELECT *', 'SELECT COUNT(*) AS total_count');
  const countStmt = prepareStatement(db, countQuery);
  const totalResult = countStmt.get(...params);
  const total = totalResult?.total_count || 0;

  // Add pagination
  query += ' ORDER BY timestamp DESC';
  const page = filter.page || 1;
  const pageSize = filter.pageSize || 50;
  query += ' LIMIT ? OFFSET ?';
  params.push(pageSize, (page - 1) * pageSize);

  // Execute query
  const stmt = prepareStatement(db, query);
  const rows = stmt.all(...params);

  // Safe JSON parse — returns fallback on corrupt/truncated data
  const safeJsonParse = (str, fallback = {}) => {
    try { return JSON.parse(str || '{}'); }
    catch { return fallback; }
  };

  // Convert back to original format
  const details = rows.map(row => ({
    id: row.id,
    provider: row.provider,
    model: row.model,
    connectionId: row.connection_id,
    timestamp: new Date(row.timestamp).toISOString(),
    status: row.status,
    latency: safeJsonParse(row.latency),
    tokens: safeJsonParse(row.tokens),
    request: safeJsonParse(row.request),
    providerRequest: safeJsonParse(row.provider_request),
    providerResponse: safeJsonParse(row.provider_response),
    response: safeJsonParse(row.response)
  }));

  return {
    details,
    pagination: {
      page,
      pageSize,
      totalItems: total,
      totalPages: Math.ceil(total / pageSize),
      hasNext: page < Math.ceil(total / pageSize),
      hasPrev: page > 1
    }
  };
}

/**
 * Get single request detail by ID
 * @param {string} id - Request detail ID
 * @returns {Promise<object|null>} Request detail or null
 */
export async function getRequestDetailById(id) {
  const db = await getRequestDetailsDb();

  if (isCloud) return null;

  const stmt = prepareStatement(db, 'SELECT * FROM request_details WHERE id = ?');
  const row = stmt.get(id);

  if (!row) return null;

  const safeJsonParse = (str, fallback = {}) => {
    try { return JSON.parse(str || '{}'); }
    catch { return fallback; }
  };

  return {
    id: row.id,
    provider: row.provider,
    model: row.model,
    connectionId: row.connection_id,
    timestamp: new Date(row.timestamp).toISOString(),
    status: row.status,
    latency: safeJsonParse(row.latency),
    tokens: safeJsonParse(row.tokens),
    request: safeJsonParse(row.request),
    providerRequest: safeJsonParse(row.provider_request),
    providerResponse: safeJsonParse(row.provider_response),
    response: safeJsonParse(row.response)
  };
}
