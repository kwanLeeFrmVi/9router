# 9router Cloud Architecture

Last updated: 2026-02-17

## Overview

A Cloudflare Worker acting as a standalone proxy/router for AI API requests, enabling access to multiple AI models/providers via a unified interface.

## Infrastructure

- **Runtime**: Cloudflare Workers (Node.js compatibility enabled).
- **Deployment**: Managed via `wrangler`.
- **Storage**:
  - **D1 Database (`proxy-db`)**: Primary storage for provider configurations, API keys, usage tracking, and machine data.
  - **KV Namespace**: Used for caching and session data.

## Core Components

- **Entry Point**: `cloud/src/index.js` routes requests.
- **Shared Logic**: Relies heavily on `open-sse` local package (`file:../open-sse`) for core translation and execution logic.
- **Handlers**: Located in `cloud/src/handlers/`.

## Data Flow & Routing

1. **Authentication**:
   - Identifies user via `machineId`.
   - **New Format**: `machineId` encoded in the Bearer token (API Key).
   - **Old Format**: `machineId` present in URL path (e.g., `/{machineId}/v1/...`).

2. **Credential Resolution**:
   - Worker queries D1 database using `machineId` to fetch stored provider credentials (API keys, access tokens).
   - Credentials are **synced** from the local 9router instance via the `/sync/{machineId}` endpoint.

3. **Execution**:
   - The Worker **directly calls** external AI providers (OpenAI, Anthropic, etc.).
   - **It does NOT forward chat traffic to the local 9router instance.** This allows the cloud proxy to function even if the local server is offline.
   - Handles token refreshing and rate limit management internally.

## Key Endpoints

- **Chat/Completion**:
  - `/v1/chat/completions` (OpenAI compatible)
  - `/v1/messages` (Anthropic compatible)
  - `/v1/api/chat` (Ollama compatible)
  - `/v1/responses` (OpenAI Responses / Codex CLI)
- **Management**:
  - `/sync/{machineId}`: Syncs provider data from local machine to Cloud D1.
  - `/v1/verify`: Verifies connectivity/auth.
  - `/forward` & `/forward-raw`: Proxy utilities.

## Development

- **Local Dev**: `npm run dev` (wraps `wrangler dev`).
- **Deploy**: `npm run deploy` (wraps `wrangler deploy`).
