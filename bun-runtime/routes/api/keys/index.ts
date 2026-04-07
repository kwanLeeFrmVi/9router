import { createApiKey, getApiKeys } from "@/lib/localDb";
import { checkAuth } from "lib/authMiddleware.ts";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

export async function GET(req: Request): Promise<Response> {
  const auth = await checkAuth(req);
  if (!auth.ok) return auth.response;
  const keys = await getApiKeys();
  return Response.json({ keys }, { headers: CORS_HEADERS });
}

export async function POST(req: Request): Promise<Response> {
  const auth = await checkAuth(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return Response.json(
      { error: "Invalid JSON" },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const name = body.name as string | undefined;
  if (!name)
    return Response.json(
      { error: "Missing required field: name" },
      { status: 400, headers: CORS_HEADERS },
    );

  const apiKey = await createApiKey(name);
  return Response.json(apiKey, { status: 201, headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/api/keys", { GET, POST, OPTIONS });
