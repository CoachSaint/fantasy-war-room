import { NextResponse } from "next/server";
import { z } from "zod";
import { getAuthenticatedRequest, hasAdminCredentials } from "@/lib/supabase/admin";
import {
  encryptYahooToken,
  exchangeYahooAuthorizationCode,
  matchesYahooOAuthState,
  yahooIntegrationConfigured,
} from "@/lib/integrations/yahoo-oauth";

export const dynamic = "force-dynamic";

const callbackSchema = z.object({
  code: z.string().min(1).max(4096).optional(),
  state: z.string().min(20).max(512).optional(),
  error: z.string().max(200).optional(),
});

function setupRedirect(request: Request, status: string): NextResponse {
  const url = new URL("/league/setup", request.url);
  url.searchParams.set("yahoo", status);
  const response = NextResponse.redirect(url);
  response.cookies.set("fwr_yahoo_oauth_state", "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/integrations/yahoo/callback",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request) {
  if (!yahooIntegrationConfigured()) return setupRedirect(request, "credentials_pending");
  if (!hasAdminCredentials()) return setupRedirect(request, "database_unavailable");
  const parsed = callbackSchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return setupRedirect(request, "invalid_callback");
  if (parsed.data.error) return setupRedirect(request, parsed.data.error === "access_denied" ? "access_denied" : "authorization_failed");

  let auth;
  try {
    auth = await getAuthenticatedRequest(request);
  } catch {
    return setupRedirect(request, "authentication_unavailable");
  }
  if (!auth) return setupRedirect(request, "authentication_required");
  const expectedState = request.headers.get("cookie")
    ?.split(";")
    .map((entry) => entry.trim().split("="))
    .find(([name]) => name === "fwr_yahoo_oauth_state")?.slice(1).join("=");
  if (!parsed.data.code || !matchesYahooOAuthState(expectedState, parsed.data.state || null, auth.user.id)) {
    return setupRedirect(request, "state_mismatch");
  }

  try {
    const tokens = await exchangeYahooAuthorizationCode(parsed.data.code);
    if (!tokens.refreshToken) return setupRedirect(request, "refresh_token_missing");
    const now = new Date().toISOString();
    const current = await auth.adminClient.from("provider_connections")
      .select("id, sync_version")
      .eq("user_id", auth.user.id)
      .eq("provider", "yahoo")
      .maybeSingle();
    if (current.error && current.error.code !== "42P01") return setupRedirect(request, "persistence_failed");
    if (current.error?.code === "42P01") return setupRedirect(request, "migration_required");
    const tokenValues = {
      user_id: auth.user.id,
      provider: "yahoo",
      external_user_id: tokens.externalUserId || null,
      access_token_ciphertext: encryptYahooToken(tokens.accessToken),
      refresh_token_ciphertext: encryptYahooToken(tokens.refreshToken),
      expires_at: tokens.expiresAt,
      scopes: tokens.scopes,
      status: "connected",
      error_code: null,
      updated_at: now,
    };
    const result = current.data
      ? await auth.adminClient.from("provider_connections").update({
          ...tokenValues,
          sync_version: Number(current.data.sync_version) + 1,
        })
          .eq("id", current.data.id)
          .eq("user_id", auth.user.id)
          .eq("sync_version", current.data.sync_version)
          .or(`sync_lock_until.is.null,sync_lock_until.lt.${now}`)
          .select("id")
          .maybeSingle()
      : await auth.adminClient.from("provider_connections").insert(tokenValues).select("id").single();
    if (result.error) return setupRedirect(request, result.error.code === "42P01" ? "migration_required" : "persistence_failed");
    if (!result.data) return setupRedirect(request, "sync_in_progress");
    return setupRedirect(request, "connected");
  } catch {
    return setupRedirect(request, "token_exchange_failed");
  }
}
