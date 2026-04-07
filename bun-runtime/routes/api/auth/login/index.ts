import { getUserByUsername, createSession } from "@/lib/localDb";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

export async function POST(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json() as Record<string, unknown>; } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400, headers: CORS_HEADERS });
  }

  const username = body.username as string | undefined;
  const password = body.password as string | undefined;

  if (!username || !password)
    return Response.json({ error: "Missing username or password" }, { status: 400, headers: CORS_HEADERS });

  const user = await getUserByUsername(username);
  if (!user) {
    // Constant-time response to prevent username enumeration
    await Bun.password.verify("dummy", "$argon2id$v=19$m=65536,t=2,p=1$AAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA");
    return Response.json({ error: "Invalid credentials" }, { status: 401, headers: CORS_HEADERS });
  }

  const valid = await Bun.password.verify(password, user.passwordHash);
  if (!valid)
    return Response.json({ error: "Invalid credentials" }, { status: 401, headers: CORS_HEADERS });

  const session = await createSession(user.id);
  return Response.json({ token: session.token, expiresAt: session.expiresAt }, { headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/api/auth/login", { POST, OPTIONS });
