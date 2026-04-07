# 9router — Self-Hosted AI API Router

A fast, self-hosted AI gateway built with **Bun** that proxies OpenAI-compatible requests to multiple AI providers (OpenAI, Anthropic Claude, Google Gemini, Ollama). Designed for single-machine deployments with a local SQLite database, a web dashboard, and a clean OpenAI-compatible API surface.

---

## Features

- **OpenAI-compatible API** — Drop-in replacement for OpenAI SDKs; just point `base_url` at this server
- **Multi-provider routing** — Send to one or many providers; combine models into "combos" for fan-out
- **Built-in auth** — Session-based dashboard login + per-client API keys
- **Proxy pool management** — Attach HTTP(S)/SOCKS proxies to providers; auto-tests connectivity
- **Token refresh & streaming** — Handles token refresh flows and SSE streaming end-to-end
- **Usage tracking** — Records every request; view logs and usage stats in the dashboard
- **SQLite persistence** — All config stored in `~/.9router/router.db` (WAL mode)
- **Embedded dashboard** — React SPA served alongside the API on the same port

---

## Quick Start

```bash
# Install dependencies
bun install

# Run the API server + dashboard
bun run index.ts
```

The server listens on port **20129** by default (configurable via `PORT` env var).

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `20129` | TCP port to listen on |
| `DATA_DIR` | `~/.9router` | Where `router.db` is stored |
| `ADMIN_USERNAME` | — | Create an admin user on first boot |
| `ADMIN_PASSWORD` | — | Password for the admin user |
| `CLOUD_URL` | — | Remote cloud sync URL (optional) |

---

## Project Structure

```
.
├── index.ts                 # Bun.serve entry point — loads routes, starts server
├── db/
│   ├── index.ts             # SQLite singleton, all CRUD helpers
│   └── schema.ts            # CREATE TABLE statements
├── routes/
│   ├── api/                 # Dashboard-facing REST API (CRUD for all resources)
│   │   ├── auth/            # Login, logout, /me
│   │   ├── keys/            # API key management
│   │   ├── providers/       # Provider connection management
│   │   ├── combos/          # Model combo management
│   │   ├── console-logs/    # Server log streaming (SSE)
│   │   ├── settings/         # Global settings
│   │   └── usage/            # Usage stats & request logs
│   ├── v1/                  # OpenAI-compatible AI API (the main proxy surface)
│   │   ├── chat/completions # POST /v1/chat/completions
│   │   ├── embeddings/       # POST /v1/embeddings
│   │   ├── messages/         # Anthropic messages API
│   │   ├── models/           # GET /v1/models
│   │   ├── responses/        # OpenAI Responses API
│   │   └── messages/count_tokens
│   └── v1beta/              # Legacy /v1beta/model routes
├── handlers/
│   ├── authMiddleware.ts    # Bearer token & session validation
│   ├── connectionProxy.ts   # HTTP proxy tunnel (CONNECT method)
│   ├── chat.ts              # Main chat handler (model routing, streaming)
│   ├── embeddings.ts        # Embedding request handler
│   ├── model.ts             # Model list / combo resolution
│   ├── tokenRefresh.ts      # Anthropic token refresh logic
│   └── auth.ts              # Login, logout, session helpers
├── ai-bridge/               # Core AI proxy logic
│   ├── index.ts             # Bootstraps all provider translators at startup
│   ├── config/
│   │   ├── providerModels.ts # Built-in model lists per provider
│   │   └── runtimeConfig.ts   # Global settings pulled from SQLite
│   ├── handlers/
│   │   ├── chatCore.ts      # Core chat execution (request building, response streaming)
│   │   ├── embeddingsCore.ts
│   │   └── provider.ts      # Provider request dispatch
│   ├── services/
│   │   ├── auth.ts          # API key validation
│   │   ├── model.ts         # Model resolution (aliases, combos, fallbacks)
│   │   └── tokenRefresh.ts  # Token refresh service
│   ├── translator/          # Request/response translators per provider pair
│   │   ├── openai/          # OpenAI → Claude / Gemini / Ollama
│   │   ├── claude/          # Claude → OpenAI / Ollama
│   │   ├── gemini/          # Gemini → OpenAI
│   │   ├── ollama/          # Ollama → Claude / OpenAI
│   │   ├── common/          # Shared: Gemini helpers, SSE parser, token counting
│   │   ├── formats.ts       # Format detection (openai, claude, gemini)
│   │   └── index.ts         # initTranslators() — wires up all format pairs
│   └── utils/
│       ├── claudeHeaderCache.ts
│       ├── error.ts
│       └── ollamaTransform.ts
├── lib/
│   ├── routeRegistry.ts     # Assembles Bun.serve routes from loaded files
│   ├── routeLoader.ts       # Auto-imports route modules
│   ├── consoleLogBuffer.ts  # Captures server-side console output (SSE feed)
│   ├── cors.ts
│   ├── logger.ts
│   └── providers.ts         # Provider connection helpers
├── dashboard/               # React + Vite dashboard SPA
│   └── src/
│       ├── pages/
│       │   ├── Login.tsx
│       │   ├── Models.tsx    # Provider nodes, combos, model aliases
│       │   ├── Providers.tsx  # Provider connections + proxy pools
│       │   ├── ApiKeys.tsx
│       │   ├── Usage.tsx     # Request logs & cost breakdown
│       │   └── Logs.tsx      # Live server log stream (SSE)
│       └── lib/
│           ├── api.ts        # Dashboard → /api/ REST client
│           ├── auth.tsx      # Session management
│           └── types.ts
└── pm2.config.js            # Production process manager config
```

---

## API Reference

### OpenAI-Compatible Endpoint

```bash
# Chat completions (drop-in OpenAI replacement)
curl http://localhost:20129/v1/chat/completions \
  -H "Authorization: Bearer $API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model": "gpt-4o", "messages": [{"role": "user", "content": "Hello"}]}'
```

| Endpoint | Description |
|---|---|
| `POST /v1/chat/completions` | Chat completions (streaming & non-streaming) |
| `POST /v1/embeddings` | Embeddings |
| `POST /v1/messages` | Anthropic Messages API |
| `GET /v1/models` | List available models |
| `POST /v1/responses` | OpenAI Responses API |
| `POST /v1beta/messages` | Legacy Anthropic beta messages |

### Dashboard REST API

All `/api/*` routes require an active dashboard session cookie or `Authorization: Bearer <session_token>`.

| Method | Path | Description |
|---|---|---|
| `POST /api/auth/login` | Authenticate |
| `POST /api/auth/logout` | Invalidate session |
| `GET /api/auth/me` | Current user |
| `GET/POST /api/keys` | List / create API keys |
| `GET/PATCH/DELETE /api/keys/:id` | Manage API key |
| `GET/POST /api/providers` | List / create provider connections |
| `GET/PATCH/DELETE /api/providers/:id` | Manage provider connection |
| `GET/POST /api/combos` | List / create model combos |
| `GET/PATCH/DELETE /api/combos/:id` | Manage combo |
| `GET /api/usage` | Aggregated usage stats |
| `GET /api/usage/request-details` | Per-request breakdown |
| `GET /api/usage/stream` | SSE usage feed |
| `GET /api/console-logs` | Server log history |
| `GET /api/console-logs/stream` | Live log stream (SSE) |
| `GET/PATCH /api/settings` | Read / update global settings |

---

## Supported Providers

| Provider | API Type | Notes |
|---|---|---|
| **OpenAI** | OpenAI | Direct proxy; no translation needed |
| **Anthropic** | Anthropic / OpenAI | Request/response translation between formats |
| **Google Gemini** | Gemini / OpenAI | REST + SSE translation |
| **Ollama** | Ollama / OpenAI / Claude | Local models; REST translation |

Each provider connection is stored as a JSON blob in SQLite and supports arbitrary config fields (base URL, API key, custom headers, proxy URL, priority, etc.).

---

## Production Deployment

```bash
# Run with PM2
pm2 start pm2.config.js

# Or directly
bun run start
```

Data is stored at `~/.9router/router.db`. The SQLite database uses **WAL mode** and supports `SO_REUSEPORT` on Linux for multi-process clustering (set `reusePort: true` in `index.ts`).

---

## Development

```bash
bun run dev          # Hot-reload server
bun run dev:dashboard  # Hot-reload dashboard
bun run migrate      # Run DB migrations (creates tables)
bun test             # Run tests (if any)
```

Dashboard is served on the same port as the API; routes like `/dashboard` and `/api` are served together via `Bun.serve`.
