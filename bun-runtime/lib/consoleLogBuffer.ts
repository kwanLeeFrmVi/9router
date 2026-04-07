// Console log buffer for server-side log capture.
// Monkey-patches console.* to write to a ring buffer; exposes SSE for live streaming.

import { EventEmitter } from "events";
import { randomUUID } from "node:crypto";

export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
}

interface ConsoleLogState {
  logs: ConsoleLogEntry[];
  patched: boolean;
  originals: Partial<Record<ConsoleLogLevel, ConsoleMethod>>;
  emitter: EventEmitter;
}

type ConsoleLogLevel = "log" | "info" | "warn" | "error" | "debug";
type ConsoleMethod = (...args: unknown[]) => void;

const MAX_LINES = 500;
const CONSOLE_LEVELS: ConsoleLogLevel[] = ["log", "info", "warn", "error", "debug"];

if (!(global as Record<string, unknown>)._consoleLogBufferState) {
  (global as Record<string, unknown>)._consoleLogBufferState = {
    logs: [],
    patched: false,
    originals: {},
    emitter: new EventEmitter(),
  };
  ((global as Record<string, unknown>)._consoleLogBufferState as ConsoleLogState).emitter.setMaxListeners(50);
}

const state = (global as Record<string, unknown>)._consoleLogBufferState as ConsoleLogState;

// Ensure emitter survives hot-reload
if (!state.emitter) {
  state.emitter = new EventEmitter();
  state.emitter.setMaxListeners(50);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function stripAnsi(str: string): string {
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

function formatArg(arg: unknown): string {
  if (typeof arg === "string") return stripAnsi(arg);
  if (arg instanceof Error) return stripAnsi(arg.stack || arg.message || String(arg));
  try { return stripAnsi(JSON.stringify(arg)); } catch { return stripAnsi(String(arg)); }
}

function buildLine(level: ConsoleLogLevel, args: unknown[]): ConsoleLogEntry {
  return {
    id: randomUUID(),
    timestamp: new Date().toISOString(),
    level,
    message: args.map(formatArg).join(" "),
  };
}

function appendEntry(entry: ConsoleLogEntry): void {
  state.logs.push(entry);
  if (state.logs.length > MAX_LINES) state.logs = state.logs.slice(-MAX_LINES);
  state.emitter.emit("line", entry);
}

// ─── Patch ─────────────────────────────────────────────────────────────────────

function patchConsole(): void {
  if (state.patched) return;

  for (const level of CONSOLE_LEVELS) {
    const original = console[level].bind(console) as ConsoleMethod;
    state.originals[level] = original;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as unknown as Record<string, ConsoleMethod>)[level] = (...args: unknown[]) => {
      appendEntry(buildLine(level, args));
      original(...args);
    };
  }

  state.patched = true;
}

// ─── Public API ────────────────────────────────────────────────────────────────

export function initConsoleLogCapture(): void {
  patchConsole();
}

export function getConsoleLogs(): ConsoleLogEntry[] {
  return state.logs;
}

export function clearConsoleLogs(): void {
  state.logs = [];
  state.emitter.emit("clear");
}

export function getConsoleEmitter(): EventEmitter {
  return state.emitter;
}

export function getLogCount(): number {
  return state.logs.length;
}