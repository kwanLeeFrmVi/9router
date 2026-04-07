// HTTP status codes and runtime constants for ai-bridge
// A clean, well-organized config file — not a dumping ground like runtimeConfig.js

export const HTTP_STATUS = {
  BAD_REQUEST:         400,
  UNAUTHORIZED:        401,
  PAYMENT_REQUIRED:    402,
  FORBIDDEN:           403,
  NOT_FOUND:           404,
  NOT_ACCEPTABLE:      406,
  REQUEST_TIMEOUT:     408,
  RATE_LIMITED:        429,
  SERVER_ERROR:        500,
  BAD_GATEWAY:         502,
  SERVICE_UNAVAILABLE: 503,
  GATEWAY_TIMEOUT:     504,
} as const;

export const ERROR_TYPES: Record<number, { type: string; code: string }> = {
  [HTTP_STATUS.BAD_REQUEST]:         { type: "invalid_request_error",   code: "bad_request"          },
  [HTTP_STATUS.UNAUTHORIZED]:        { type: "authentication_error",   code: "invalid_api_key"      },
  [HTTP_STATUS.FORBIDDEN]:           { type: "permission_error",        code: "insufficient_quota"  },
  [HTTP_STATUS.NOT_FOUND]:           { type: "invalid_request_error",   code: "model_not_found"     },
  [HTTP_STATUS.NOT_ACCEPTABLE]:      { type: "invalid_request_error",   code: "model_not_supported" },
  [HTTP_STATUS.RATE_LIMITED]:        { type: "rate_limit_error",         code: "rate_limit_exceeded" },
  [HTTP_STATUS.SERVER_ERROR]:        { type: "server_error",             code: "internal_server_error"},
  [HTTP_STATUS.BAD_GATEWAY]:         { type: "server_error",             code: "bad_gateway"         },
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: { type: "server_error",             code: "service_unavailable" },
  [HTTP_STATUS.GATEWAY_TIMEOUT]:     { type: "server_error",             code: "gateway_timeout"    },
};

export const DEFAULT_ERROR_MESSAGES: Record<number, string> = {
  [HTTP_STATUS.BAD_REQUEST]:         "Bad request",
  [HTTP_STATUS.UNAUTHORIZED]:        "Invalid API key provided",
  [HTTP_STATUS.FORBIDDEN]:           "You exceeded your current quota",
  [HTTP_STATUS.NOT_FOUND]:           "Model not found",
  [HTTP_STATUS.NOT_ACCEPTABLE]:      "Model not supported",
  [HTTP_STATUS.RATE_LIMITED]:        "Rate limit exceeded",
  [HTTP_STATUS.SERVER_ERROR]:        "Internal server error",
  [HTTP_STATUS.BAD_GATEWAY]:         "Bad gateway — upstream provider error",
  [HTTP_STATUS.SERVICE_UNAVAILABLE]: "Service temporarily unavailable",
  [HTTP_STATUS.GATEWAY_TIMEOUT]:    "Gateway timeout",
};

export const CACHE_TTL = {
  userInfo:   300,   // 5 minutes
  modelAlias: 3600,  // 1 hour
} as const;

export const DEFAULT_MAX_TOKENS = 64000;
export const DEFAULT_MIN_TOKENS = 32000;
export const DEFAULT_BUDGET_TOKENS = 10000;

export const BACKOFF_CONFIG = {
  base:    1000,      // 1 second
  max:     120_000,   // 2 minutes
  maxLevel: 15,
} as const;

// Cooldown windows per error category (milliseconds)
export const COOLDOWN_MS = {
  unauthorized:       2 * 60_000,
  paymentRequired:    2 * 60_000,
  notFound:           2 * 60_000,
  transient:          30_000,
  requestNotAllowed:  5_000,
  rateLimit:          2 * 60_000,  // legacy alias
  serviceUnavailable: 2_000,      // legacy alias
  authExpired:        2 * 60_000, // legacy alias
} as const;

export const MEMORY_CONFIG = {
  sessionTtlMs:             2 * 60 * 60 * 1000,
  sessionCleanupIntervalMs: 30 * 60 * 1000,
  dnsCacheTtlMs:           5 * 60 * 1000,
  proxyDispatchersMaxSize:  20,
} as const;

export const TOKEN_EXPIRY_BUFFER_MS = 5 * 60 * 1000; // 5 minutes before expiry → proactive refresh