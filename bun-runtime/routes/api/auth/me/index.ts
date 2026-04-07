import { getUserById } from "@/lib/localDb";
import { checkAdminAuth } from "lib/authMiddleware.ts";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

export async function GET(req: Request): Promise<Response> {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return auth.response;

  const user = await getUserById(auth.userId);
  if (!user) return Response.json({ error: "User not found" }, { status: 404, headers: CORS_HEADERS });

  return Response.json({ id: user.id, username: user.username }, { headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/api/auth/me", { GET, OPTIONS });
