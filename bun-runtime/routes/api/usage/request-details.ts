// GET /api/usage/request-details — paginated request log with filters
import { getUsageDetails } from "@/lib/usageDb";
import { checkAdminAuth } from "lib/authMiddleware.ts";
import { CORS_HEADERS } from "lib/cors.ts";
import { register } from "lib/routeRegistry";

export async function GET(req: Request): Promise<Response> {
  const auth = await checkAdminAuth(req);
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const result = getUsageDetails({
    page:     parseInt(url.searchParams.get("page")     ?? "1"),
    limit:    parseInt(url.searchParams.get("limit")    ?? "50"),
    provider: url.searchParams.get("provider")         ?? undefined,
    model:    url.searchParams.get("model")            ?? undefined,
    period:   url.searchParams.get("period")           ?? "24h",
  });

  return Response.json(result, { headers: CORS_HEADERS });
}

export function OPTIONS(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

register("/api/usage/request-details", { GET, OPTIONS });
