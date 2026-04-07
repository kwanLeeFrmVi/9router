import { getCombos, getComboByName, createCombo } from "@/lib/localDb";
import { checkAuth } from "lib/authMiddleware.ts";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

const NAME_REGEX = /^[a-zA-Z0-9_.\-]+$/;

export async function GET(req: Request): Promise<Response> {
  const auth = await checkAuth(req);
  if (!auth.ok) return auth.response;
  const combos = await getCombos();
  return Response.json({ combos }, { headers: CORS_HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await checkAuth(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }

  const name = body.name as string | undefined;
  const models = (body.models as string[] | undefined) ?? [];

  if (!name || !NAME_REGEX.test(name))
    return Response.json({ error: "Invalid name — use letters, numbers, _ . -" }, { status: 400, headers: CORS_HEADERS });
  if (await getComboByName(name))
    return Response.json({ error: "Name already exists" }, { status: 400, headers: CORS_HEADERS });

  const combo = await createCombo({ name, models });
  return Response.json(combo, { status: 201, headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/api/combos", { GET, POST, OPTIONS });
