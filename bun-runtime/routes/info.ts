// Port of src/app/api/v1/route.js
import { CORS_HEADERS } from "../lib/cors.ts";

const STATIC_MODELS = [
  { id: "claude-sonnet-4-20250514", object: "model", owned_by: "anthropic" },
  { id: "claude-3-5-sonnet-20241022", object: "model", owned_by: "anthropic" },
  { id: "gpt-4o", object: "model", owned_by: "openai" },
  { id: "gemini-2.5-pro", object: "model", owned_by: "google" },
];

export function infoHandler(_req: Request): Response {
  return new Response(JSON.stringify({ object: "list", data: STATIC_MODELS }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS },
  });
}
