// ai-bridge — native TypeScript translation layer for AI API requests.
// Replaces the open-sse npm package with clean, idiomatic TypeScript.

import { initTranslators } from "./translator/index.ts";

export { FORMATS, fromString, detectFormatByEndpoint } from "./translator/formats.ts";
export type { Format } from "./translator/formats.ts";

export {
  Request,
  Response,
  ResponseNonStream,
  NeedsTranslation,
  initTranslators,
} from "./translator/index.ts";

// Re-export config
export {
  HTTP_STATUS,
  ERROR_TYPES,
  DEFAULT_ERROR_MESSAGES,
  CACHE_TTL,
  BACKOFF_CONFIG,
  COOLDOWN_MS,
  TOKEN_EXPIRY_BUFFER_MS,
  DEFAULT_MAX_TOKENS,
} from "./config/runtimeConfig.ts";

// Re-export provider models
export {
  PROVIDER_MODELS,
  PROVIDER_ID_TO_ALIAS,
  getProviderModels,
  getDefaultModel,
  isValidModel,
  findModelName,
  getModelTargetFormat,
  getModelsByProviderId,
} from "./config/providerModels.ts";
export type { ModelEntry } from "./config/providerModels.ts";

// Re-export utils
export {
  errorResponse,
  unavailableResponse,
  buildErrorBody,
  createErrorResult,
  parseAntigravityRetryTime,
  parseUpstreamError,
  formatProviderError,
} from "./utils/error.ts";

export {
  cacheClaudeHeaders,
  getCachedClaudeHeaders,
} from "./utils/claudeHeaderCache.ts";

export { transformToOllama } from "./utils/ollamaTransform.ts";

// Re-export thinking
export {
  THINKING_LEVELS,
  convertBudgetToLevel,
  getThinkingText,
  levelToBudget,
  buildThinkingBlock,
} from "./translator/thinking/index.ts";
export type { ThinkingLevel } from "./translator/thinking/index.ts";

// Re-export SSE utilities
export {
  buildSSEEvent,
  buildSSEData,
  appendSSEEventBytes,
  appendSSEDataBytes,
  formatTokenDataEvent,
} from "./translator/common/sse.ts";

// Re-export token utilities
export {
  formatClaudeTokens,
  formatGeminiTokens,
  buildClaudeUsage,
  extractTokensFromOpenAIUsage,
} from "./translator/common/tokens.ts";

// Re-export gemini utilities
export {
  wrapGeminiResponse,
  parseGeminiSSEError,
  geminiErrorChunk,
} from "./translator/common/gemini.ts";

// Re-export translator utilities
export {
  sanitizeClaudeToolID,
  toolNameMapFromRequest,
  mapToolName,
  fixPartialJSON,
  isValidJSON,
  ensureToolCallIds,
} from "./translator/util/index.ts";

// ─── Initialization ─────────────────────────────────────────────────────────────

// Initialize all translator pairs on first import
initTranslators();
