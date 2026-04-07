// No-op stubs for @/lib/usageDb.js
// open-sse internals import usage tracking; bun-runtime stubs these out.

export const trackPendingRequest = (..._args: unknown[]): void => {};
export const appendRequestLog = async (..._args: unknown[]): Promise<void> => {};
export const saveRequestDetail = async (..._args: unknown[]): Promise<void> => {};
export const saveRequestUsage = async (..._args: unknown[]): Promise<void> => {};
export const statsEmitter = {
  emit: (..._args: unknown[]) => false,
  on: (..._args: unknown[]) => statsEmitter,
  off: (..._args: unknown[]) => statsEmitter,
  once: (..._args: unknown[]) => statsEmitter,
  removeAllListeners: (..._args: unknown[]) => statsEmitter,
};
