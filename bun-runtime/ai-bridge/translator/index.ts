// Translator registry — maps source/target format pairs to translation functions.
// Written from scratch in TypeScript.

import { FORMATS } from "./formats.ts";
import { convertClaudeRequestToOpenAI } from "./claude/openai/request.ts";
import { convertOpenAIResponseToClaude, convertOpenAIResponseToClaudeNonStream } from "./claude/openai/response.ts";
import { convertOpenAIRequestToClaude } from "./openai/claude/request.ts";
import { convertClaudeResponseToOpenAI, convertClaudeResponseToOpenAINonStream } from "./openai/claude/response.ts";
import { convertClaudeRequestToOllama } from "./claude/ollama/request.ts";
import { convertOllamaRequestToClaude } from "./ollama/claude/request.ts";
import { convertOllamaResponseToClaude, convertOllamaResponseToClaudeNonStream } from "./ollama/claude/response.ts";
import { convertOllamaRequestToOpenAI } from "./ollama/openai/request.ts";
import { convertOpenAIRequestToOllama } from "./openai/ollama/request.ts";
import { convertGeminiRequestToOpenAI } from "./gemini/openai/request.ts";
import { convertGeminiResponseToOpenAI, convertGeminiResponseToOpenAINonStream } from "./gemini/openai/response.ts";
import { convertOpenAIRequestToGemini } from "./openai/gemini/request.ts";
import { convertOpenAIResponseToGemini, convertOpenAIResponseToGeminiNonStream } from "./openai/gemini/response.ts";

// ─── Function signatures ────────────────────────────────────────────────────────

export type RequestTranslatorFn = (
  modelName: string,
  inputRaw: Uint8Array,
  stream: boolean
) => Uint8Array;

export type ResponseTranslatorFn = (
  ctx: unknown,
  modelName: string,
  originalRequestRaw: Uint8Array,
  requestRaw: Uint8Array,
  raw: Uint8Array,
  state: unknown
) => Uint8Array[];

export type ResponseNonStreamFn = (
  ctx: unknown,
  modelName: string,
  originalRequestRaw: Uint8Array,
  requestRaw: Uint8Array,
  raw: Uint8Array
) => Uint8Array;

// ─── Registry ──────────────────────────────────────────────────────────────────

const requestRegistry = new Map<string, RequestTranslatorFn>();
const responseRegistry = new Map<string, ResponseTranslatorFn>();
const responseNonStreamRegistry = new Map<string, ResponseNonStreamFn>();

// ─── Registration helper ─────────────────────────────────────────────────────────

function register(
  from: string,
  to: string,
  requestFn: RequestTranslatorFn | null,
  responseFn: ResponseTranslatorFn | null,
  responseNonStreamFn: ResponseNonStreamFn | null = null
): void {
  const key = `${from}:${to}`;
  if (requestFn) requestRegistry.set(key, requestFn);
  if (responseFn) responseRegistry.set(key, responseFn);
  if (responseNonStreamFn) responseNonStreamRegistry.set(key, responseNonStreamFn);
}

// ─── Identity (pass-through) ───────────────────────────────────────────────────

function identity(_modelName: string, raw: Uint8Array): Uint8Array {
  return raw;
}
function identityResponse(_ctx: unknown, _m: string, _o: Uint8Array, _r: Uint8Array, raw: Uint8Array): Uint8Array[] {
  return [raw];
}
function identityResponseNS(_ctx: unknown, _m: string, _o: Uint8Array, _r: Uint8Array, raw: Uint8Array): Uint8Array {
  return raw;
}

function registerIdentity(format: string): void {
  register(format, format, identity, identityResponse, identityResponseNS);
}

// ─── Initialize all pairs ───────────────────────────────────────────────────────

function init(): void {
  // Claude ↔ OpenAI
  register(FORMATS.CLAUDE, FORMATS.OPENAI, convertClaudeRequestToOpenAI, convertOpenAIResponseToClaude as ResponseTranslatorFn, convertOpenAIResponseToClaudeNonStream as ResponseNonStreamFn);
  register(FORMATS.OPENAI, FORMATS.CLAUDE, convertOpenAIRequestToClaude, convertClaudeResponseToOpenAI as ResponseTranslatorFn, convertClaudeResponseToOpenAINonStream as ResponseNonStreamFn);

  // Claude ↔ Ollama
  register(FORMATS.CLAUDE, FORMATS.OLLAMA, convertClaudeRequestToOllama, identityResponse, identityResponseNS);
  register(FORMATS.OLLAMA, FORMATS.CLAUDE, convertOllamaRequestToClaude, convertOllamaResponseToClaude as ResponseTranslatorFn, convertOllamaResponseToClaudeNonStream as ResponseNonStreamFn);

  // Ollama ↔ OpenAI (both are OpenAI-compatible; minimal translation needed)
  register(FORMATS.OLLAMA, FORMATS.OPENAI, convertOllamaRequestToOpenAI, identityResponse, identityResponseNS);
  register(FORMATS.OPENAI, FORMATS.OLLAMA, convertOpenAIRequestToOllama, identityResponse, identityResponseNS);

  // Gemini ↔ OpenAI
  register(FORMATS.GEMINI, FORMATS.OPENAI, convertGeminiRequestToOpenAI, convertGeminiResponseToOpenAI as ResponseTranslatorFn, convertGeminiResponseToOpenAINonStream as ResponseNonStreamFn);
  register(FORMATS.OPENAI, FORMATS.GEMINI, convertOpenAIRequestToGemini, convertOpenAIResponseToGemini as ResponseTranslatorFn, convertOpenAIResponseToGeminiNonStream as ResponseNonStreamFn);

  // Identity (pass-through) pairs
  registerIdentity(FORMATS.OPENAI);
  registerIdentity(FORMATS.OPENAI_RESPONSES);
  registerIdentity(FORMATS.CLAUDE);
  registerIdentity(FORMATS.GEMINI);
  registerIdentity(FORMATS.GEMINI_CLI);
  registerIdentity(FORMATS.VERTEX);
  registerIdentity(FORMATS.CODEX);
  registerIdentity(FORMATS.ANTIGRAVITY);
  registerIdentity(FORMATS.KIRO);
  registerIdentity(FORMATS.CURSOR);
  registerIdentity(FORMATS.OLLAMA);
}

init();

// ─── Public API ─────────────────────────────────────────────────────────────────

export function Request(
  from: string,
  to: string,
  modelName: string,
  inputRaw: Uint8Array,
  stream: boolean
): Uint8Array {
  const key = `${from}:${to}`;
  const fn = requestRegistry.get(key);
  return fn ? fn(modelName, inputRaw, stream) : inputRaw;
}

export function Response(
  from: string,
  to: string,
  ctx: unknown,
  modelName: string,
  originalRequestRaw: Uint8Array,
  requestRaw: Uint8Array,
  raw: Uint8Array,
  state: unknown
): Uint8Array[] {
  const key = `${from}:${to}`;
  const fn = responseRegistry.get(key);
  return fn ? fn(ctx, modelName, originalRequestRaw, requestRaw, raw, state) : [raw];
}

export function ResponseNonStream(
  from: string,
  to: string,
  ctx: unknown,
  modelName: string,
  originalRequestRaw: Uint8Array,
  requestRaw: Uint8Array,
  raw: Uint8Array
): Uint8Array {
  const key = `${from}:${to}`;
  const fn = responseNonStreamRegistry.get(key);
  return fn ? fn(ctx, modelName, originalRequestRaw, requestRaw, raw) : raw;
}

export function NeedsTranslation(from: string, to: string): boolean {
  return from !== to;
}

export function initTranslators(): void {
  // No-op: all pairs are initialized statically
}

// Re-export types
export type { StreamingState } from "./claude/openai/response.ts";
export type { OpenAIStreamingState } from "./openai/claude/response.ts";
export type { OllamaStreamingState } from "./ollama/claude/response.ts";
export type { GeminiStreamingState } from "./gemini/openai/response.ts";
export type { OpenAIGeminiState } from "./openai/gemini/response.ts";
