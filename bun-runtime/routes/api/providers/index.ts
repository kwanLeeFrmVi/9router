import { getProviderConnections, createProviderConnection } from "@/lib/localDb";
import { checkAuth } from "lib/authMiddleware.ts";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

const SENSITIVE_FIELDS = ["apiKey", "accessToken", "refreshToken", "idToken"];

function sanitize(conn: Record<string, unknown>): Record<string, unknown> {
  const safe = { ...conn };
  for (const k of SENSITIVE_FIELDS) delete safe[k];
  return safe;
}

export async function GET(req: Request): Promise<Response> {
  const auth = await checkAuth(req);
  if (!auth.ok) return auth.response;
  const connections = await getProviderConnections();
  return Response.json({ connections: connections.map(c => sanitize(c as Record<string, unknown>)) }, { headers: CORS_HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await checkAuth(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }

  if (!body.provider)
    return Response.json({ error: "Missing required field: provider" }, { status: 400, headers: CORS_HEADERS });

  const connection = await createProviderConnection(body);
  return Response.json(sanitize(connection as Record<string, unknown>), { status: 201, headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/api/providers", { GET, POST, OPTIONS });
