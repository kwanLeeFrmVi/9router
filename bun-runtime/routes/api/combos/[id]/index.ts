
import { checkAdminAuth } from "lib/authMiddleware.ts";
import { deleteCombo, getComboById, getComboByName, updateCombo } from "@/lib/localDb";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

type BunRequest = Request & { params: Record<string, string> };
const NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

export async function GET(req: Request): Promise<Response> {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return auth.response;
  const id = (req as BunRequest).params.id ?? "";
  const combo = await getComboById(id);
  if (!combo) return Response.json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
  return Response.json(combo, { headers: CORS_HEADERS });
}

export async function PUT(req: Request): Promise<Response> {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return auth.response;

  const id = (req as BunRequest).params.id ?? "";
  const combo = await getComboById(id);
  if (!combo) return Response.json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }

  const name = body.name as string | undefined;
  const models = body.models as string[] | undefined;

  if (name !== undefined) {
    if (!NAME_REGEX.test(name))
      return Response.json({ error: "Invalid name — use letters, numbers, _ . -" }, { status: 400, headers: CORS_HEADERS });
    const existing = await getComboByName(name);
    if (existing && existing.id !== id)
      return Response.json({ error: "Name already exists" }, { status: 400, headers: CORS_HEADERS });
  }

  const updated = await updateCombo(id, {
    ...(name !== undefined && { name }),
    ...(models !== undefined && { models }),
  });
  return Response.json(updated, { headers: CORS_HEADERS });
}

export async function DELETE(req: Request): Promise<Response> {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return auth.response;
  const id = (req as BunRequest).params.id ?? "";
  const combo = await getComboById(id);
  if (!combo) return Response.json({ error: "Not found" }, { status: 404, headers: CORS_HEADERS });
  await deleteCombo(id);
  return Response.json({ success: true }, { headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/api/combos/:id", { GET, PUT, DELETE, OPTIONS });
