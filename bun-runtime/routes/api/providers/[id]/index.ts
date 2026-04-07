

import { getProviderConnectionById, updateProviderConnection, deleteProviderConnection } from "@/lib/localDb";
import { checkAuth } from "lib/authMiddleware.ts";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

type BunRequest = Request & { params: Record<string, string> };

export async function GET(req: Request): Promise<Response> {
  const auth = await checkAuth(req);
  if (!auth.ok) return auth.response;
  const id = (req as BunRequest).params.id ?? "";
  const connection = await getProviderConnectionById(id);
  if (!connection) return Response.json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
  return Response.json(connection, { headers: CORS_HEADERS });
}

export async function PUT(req: Request): Promise<Response> {
  const auth = await checkAuth(req);
  if (!auth.ok) return auth.response;

  const id = (req as BunRequest).params.id ?? "";
  const existing = await getProviderConnectionById(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }

  const updated = await updateProviderConnection(id, body);
  return Response.json(updated, { headers: CORS_HEADERS });
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await checkAuth(req);
  if (!auth.ok) return auth.response;
  const id = (req as BunRequest).params.id ?? "";
  const existing = await getProviderConnectionById(id);
  if (!existing) return Response.json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
  await deleteProviderConnection(id);
  return Response.json({ success: true }, { headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/api/providers/:id", { GET, PUT, DELETE, OPTIONS });
