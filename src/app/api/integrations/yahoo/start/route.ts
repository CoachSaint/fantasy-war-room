import { NextResponse } from "next/server";
import { getAuthenticatedRequest, hasAdminCredentials } from "@/lib/supabase/admin";
import { buildYahooAuthorizationUrl, createYahooOAuthState, yahooIntegrationConfigured } from "@/lib/integrations/yahoo-oauth";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!yahooIntegrationConfigured()) return errorResponse("yahoo_credentials_pending", 503);
  if (!hasAdminCredentials()) return errorResponse("supabase_unavailable", 503);
  let auth;
  try {
    auth = await getAuthenticatedRequest(request);
  } catch {
    return errorResponse("authentication_unavailable", 503);
  }
  if (!auth) return errorResponse("authentication_required", 401);

  const state = createYahooOAuthState(auth.user.id);
  const response = NextResponse.redirect(buildYahooAuthorizationUrl(state));
  response.cookies.set("fwr_yahoo_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/yahoo/callback",
    maxAge: 10 * 60,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
