// Bun runtime entry point for 9router v1 API endpoints
// Must patch global fetch first (open-sse proxy support)
import "open-sse/index.js";

import { initTranslators } from "open-sse/translator/index.js";
import { openDb } from "./db/index.ts";
import { corsResponse } from "./lib/cors.ts";

import { chatCompletionsHandler } from "./routes/chatCompletions.ts";
import { messagesHandler } from "./routes/messages.ts";
import { responsesHandler } from "./routes/responses.ts";
import { embeddingsHandler } from "./routes/embeddings.ts";
import { countTokensHandler } from "./routes/countTokens.ts";
import { infoHandler } from "./routes/info.ts";
import { modelsHandler } from "./routes/models.ts";
import { ollamaChatHandler } from "./routes/ollamaChat.ts";
import { geminiModelsHandler } from "./routes/geminiModels.ts";
import { geminiGenerateHandler } from "./routes/geminiGenerate.ts";

// Initialize DB (creates tables, opens WAL connection)
openDb();

// Initialize translators once at boot
await initTranslators();
console.log("[BUN] Translators initialized");

const PORT = parseInt(process.env.PORT ?? "20129");

const server = Bun.serve({
  port: PORT,
  routes: {
    // v1 endpoints
    "/v1": {
      GET:     infoHandler,
      OPTIONS: () => corsResponse(),
    },
    "/v1/models": {
      GET:     modelsHandler,
      OPTIONS: () => corsResponse(),
    },
    "/v1/chat/completions": {
      POST:    chatCompletionsHandler,
      OPTIONS: () => corsResponse(),
    },
    "/v1/messages": {
      POST:    messagesHandler,
      OPTIONS: () => corsResponse(),
    },
    "/v1/messages/count_tokens": {
      POST:    countTokensHandler,
      OPTIONS: () => corsResponse(),
    },
    "/v1/responses": {
      POST:    responsesHandler,
      OPTIONS: () => corsResponse(),
    },
    "/v1/embeddings": {
      POST:    embeddingsHandler,
      OPTIONS: () => corsResponse(),
    },
    "/v1/api/chat": {
      POST:    ollamaChatHandler,
      OPTIONS: () => corsResponse(),
    },
    "/v1beta/models": {
      GET:     geminiModelsHandler,
      OPTIONS: () => corsResponse(),
    },
    "/v1beta/models/*": {
      POST:    geminiGenerateHandler,
      OPTIONS: () => corsResponse(),
    },
  },

  fetch(req) {
    // Handle OPTIONS for any unmatched path
    if (req.method === "OPTIONS") return corsResponse();
    return new Response("Not found", { status: 404 });
  },
});

console.log(`[BUN] Listening on port ${server.port}`);
