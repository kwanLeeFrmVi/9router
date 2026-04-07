// Shared TypeScript types for the dashboard

export interface ProviderConnection {
  id: string;
  provider: string;
  [key: string]: unknown;
}

export interface ApiKeyRecord {
  id: string;
  name: string;
  key: string;
  isActive: boolean;
  createdAt?: string;
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

export interface ConsoleLogEntry {
  id: string;
  timestamp: string;
  level: string;
  message: string;
}
