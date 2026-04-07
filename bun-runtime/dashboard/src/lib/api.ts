const BASE_URL = import.meta.env.VITE_API_URL ?? "";

function getToken(): string | null {
  return localStorage.getItem("auth_token");
}

async function request<T>(
  path: string,
  init: RequestInit = {}
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(init.headers as Record<string, string> | undefined),
  };
  if (token) headers["Authorization"] = `Bearer ${token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...init, headers });

  if (res.status === 401) {
    localStorage.removeItem("auth_token");
    window.location.hash = "#/login";
    throw new Error("Unauthorized");
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }

  return res.json() as Promise<T>;
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

export interface LoginResponse { token: string; username: string }

export const api = {
  auth: {
    login: (username: string, password: string) =>
      request<LoginResponse>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ username, password }),
      }),
    logout: () => request("/api/auth/logout", { method: "POST" }),
    me: () => request<{ username: string }>("/api/auth/me"),
  },

  // ─── Providers ─────────────────────────────────────────────────────────────
  providers: {
    list:  () => request<{ connections: unknown[] }>("/api/providers"),
    create: (data: unknown) => request("/api/providers", { method: "POST", body: JSON.stringify(data) }),
    update: (id: string, data: unknown) => request(`/api/providers/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    remove: (id: string) => request(`/api/providers/${id}`, { method: "DELETE" }),
  },

  // ─── API Keys ─────────────────────────────────────────────────────────────
  keys: {
    list:    () => request<{ keys: unknown[] }>("/api/keys"),
    create:  (name: string) => request("/api/keys", { method: "POST", body: JSON.stringify({ name }) }),
    update:  (id: string, data: unknown) => request(`/api/keys/${id}`, { method: "PUT", body: JSON.stringify(data) }),
    remove:  (id: string) => request(`/api/keys/${id}`, { method: "DELETE" }),
  },

  // ─── Usage ────────────────────────────────────────────────────────────────
  usage: {
    stats:         (period = "24h") => request<unknown>(`/api/usage/stats?period=${period}`),
    requestDetails: (params: Record<string, string> = {}) => {
      const qs = new URLSearchParams(params).toString();
      return request<{ rows: unknown[]; total: number }>(`/api/usage/request-details${qs ? `?${qs}` : ""}`);
    },
  },

  // ─── Console Logs ─────────────────────────────────────────────────────────
  consoleLogs: {
    list:  () => request<unknown[]>("api/console-logs"),
    clear: () => request("api/console-logs", { method: "DELETE" }),
  },

  // ─── Settings ─────────────────────────────────────────────────────────────
  settings: {
    get:    () => request<unknown>("/api/settings"),
    update: (data: unknown) => request("/api/settings", { method: "PUT", body: JSON.stringify(data) }),
  },

  // ─── Models ───────────────────────────────────────────────────────────────
  models: {
    list: () => request<{ data: { id: string; created: number }[] }>("/v1/models"),
  },
};
