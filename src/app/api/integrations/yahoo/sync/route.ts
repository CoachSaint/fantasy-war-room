import { getAuthenticatedRequest, hasAdminCredentials } from "@/lib/supabase/admin";
import { yahooIntegrationConfigured } from "@/lib/integrations/yahoo-oauth";
import { runYahooSync } from "@/lib/integrations/yahoo-runner";
import { clientKey, consumeRateLimit, errorResponse, rateLimitResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  if (!yahooIntegrationConfigured()) return errorResponse("yahoo_credentials_pending", 503);
  if (!hasAdminCredentials()) return errorResponse("supabase_unavailable", 503);
  let auth;
  try {
    auth = await getAuthenticatedRequest(request);
  } catch {
    return errorResponse("authentication_unavailable", 503);
  }
  if (!auth) return errorResponse("authentication_required", 401);
  const limit = consumeRateLimit(clientKey(request, `yahoo:${auth.user.id}`), { limit: 3, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);
  return runYahooSync(auth.adminClient, auth.user.id);
}
