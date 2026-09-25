import { NextResponse } from "next/server";
import { getYahooAvailablePool, getYahooLeagueImports } from "@/lib/data/yahoo";
import { getAuthenticatedRequest, hasAdminCredentials } from "@/lib/supabase/admin";
import {
  decryptYahooToken,
  encryptYahooToken,
  refreshYahooAccessToken,
  yahooIntegrationConfigured,
} from "@/lib/integrations/yahoo-oauth";
import { persistYahooAvailablePool, persistYahooImports, YahooSyncError } from "@/lib/integrations/yahoo-sync";
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

  const connectionResult = await auth.adminClient
    .from("provider_connections")
    .select("id, external_user_id, access_token_ciphertext, refresh_token_ciphertext, expires_at, status, sync_lock_until, sync_version")
    .eq("user_id", auth.user.id)
    .eq("provider", "yahoo")
    .maybeSingle();
  if (connectionResult.error) return errorResponse(connectionResult.error.code === "42P01" ? "yahoo_migration_required" : "yahoo_connection_unavailable", 503);
  if (!connectionResult.data || connectionResult.data.status === "revoked") return errorResponse("yahoo_connection_required", 409);

  const lockNow = new Date();
  // The provider path is bounded to ten leagues, 32 teams, four roster fetches
  // at a time, and 15 seconds per request. Thirty minutes exceeds that worst
  // case plus persistence while still recovering an abandoned invocation.
  const lockUntil = new Date(lockNow.getTime() + 30 * 60_000).toISOString();
  const nextVersion = Number(connectionResult.data.sync_version) + 1;
  const claimResult = await auth.adminClient
    .from("provider_connections")
    .update({ sync_lock_until: lockUntil, sync_version: nextVersion, updated_at: lockNow.toISOString() })
    .eq("id", connectionResult.data.id)
    .eq("user_id", auth.user.id)
    .eq("sync_version", connectionResult.data.sync_version)
    .or(`sync_lock_until.is.null,sync_lock_until.lt.${lockNow.toISOString()}`)
    .select("id, external_user_id, access_token_ciphertext, refresh_token_ciphertext, expires_at, status, sync_version")
    .maybeSingle();
  if (claimResult.error) return errorResponse(claimResult.error.code === "42P01" ? "yahoo_migration_required" : "yahoo_connection_unavailable", 503);
  if (!claimResult.data) return errorResponse("yahoo_sync_in_progress", 409);
  const connection = claimResult.data;

  try {
    let accessToken: string;
    let refreshToken: string;
    try {
      accessToken = decryptYahooToken(String(connection.access_token_ciphertext));
      refreshToken = decryptYahooToken(String(connection.refresh_token_ciphertext));
    } catch {
      return errorResponse("yahoo_token_unavailable", 503);
    }

    if (new Date(String(connection.expires_at)).getTime() <= Date.now() + 5 * 60_000) {
      const refreshed = await refreshYahooAccessToken(refreshToken);
      accessToken = refreshed.accessToken;
      refreshToken = refreshed.refreshToken || refreshToken;
      const tokenUpdate = await auth.adminClient.from("provider_connections").update({
        access_token_ciphertext: encryptYahooToken(accessToken),
        refresh_token_ciphertext: encryptYahooToken(refreshToken),
        expires_at: refreshed.expiresAt,
        external_user_id: refreshed.externalUserId || connection.external_user_id,
        scopes: refreshed.scopes,
        status: "connected",
        error_code: null,
        updated_at: new Date().toISOString(),
      }).eq("id", connection.id).eq("user_id", auth.user.id).eq("sync_version", connection.sync_version).select("id").maybeSingle();
      if (tokenUpdate.error || !tokenUpdate.data) return errorResponse("yahoo_token_persistence_failed", 503);
    }

    const runResult = await auth.adminClient.from("provider_sync_runs").insert({
      connection_id: connection.id,
      user_id: auth.user.id,
      provider: "yahoo",
      status: "running",
    }).select("id").single();
    if (runResult.error || !runResult.data) return errorResponse(runResult.error?.code === "42P01" ? "yahoo_migration_required" : "yahoo_sync_persistence_failed", 503);
    const runId = String(runResult.data.id);

    try {
      const imports = await getYahooLeagueImports(accessToken);
      const summary = await persistYahooImports(
        auth.adminClient,
        auth.user.id,
        String(connection.id),
        connection.external_user_id ? String(connection.external_user_id) : null,
        imports
      );
      let availablePlayersProcessed = 0;
      let truncatedAvailabilityScans = 0;
      let availabilityError: string | null = null;
      for (const [index, imported] of imports.entries()) {
        try {
          const pool = await getYahooAvailablePool(accessToken, imported.leagueKey);
          availablePlayersProcessed += await persistYahooAvailablePool(
            auth.adminClient, summary.leagueIds[index], imported, pool
          );
          if (pool.truncated) truncatedAvailabilityScans += 1;
        } catch (error) {
          availabilityError ??= error instanceof YahooSyncError ? error.code
            : error instanceof Error && error.message.startsWith("yahoo_") ? error.message : "yahoo_available_sync_failed";
        }
      }
      const finishedAt = new Date().toISOString();
      const connectionUpdate = await auth.adminClient.from("provider_connections").update({
        status: "connected",
        error_code: availabilityError,
        last_synced_at: finishedAt,
        updated_at: finishedAt,
      }).eq("id", connection.id).eq("user_id", auth.user.id).eq("sync_version", connection.sync_version).select("id").maybeSingle();
      if (connectionUpdate.error || !connectionUpdate.data) return errorResponse("yahoo_sync_lock_lost", 409);
      const runUpdate = await auth.adminClient.from("provider_sync_runs").update({
          status: availabilityError ? "completed_with_errors" : "completed",
          leagues_processed: summary.leaguesProcessed,
          rosters_processed: summary.rostersProcessed,
          players_processed: summary.playersProcessed,
          matchups_processed: summary.matchupsProcessed,
          available_players_processed: availablePlayersProcessed,
          error_code: availabilityError,
          finished_at: finishedAt,
        }).eq("id", runId).eq("user_id", auth.user.id);
      if (runUpdate.error) return errorResponse("yahoo_sync_persistence_failed", 503);
      return NextResponse.json({
        ok: !availabilityError, status: availabilityError ? "degraded" : "completed",
        ...(availabilityError ? { error: availabilityError } : {}),
        data: { ...summary, availablePlayersProcessed, truncatedAvailabilityScans },
      }, { status: availabilityError ? 503 : 200 });
    } catch (error) {
      const code = error instanceof YahooSyncError ? error.code : error instanceof Error && error.message.startsWith("yahoo_") ? error.message : "yahoo_sync_failed";
      const finishedAt = new Date().toISOString();
      await Promise.all([
        auth.adminClient.from("provider_sync_runs").update({ status: "failed", error_code: code, finished_at: finishedAt }).eq("id", runId).eq("user_id", auth.user.id),
        auth.adminClient.from("provider_connections").update({ status: "error", error_code: code, updated_at: finishedAt }).eq("id", connection.id).eq("user_id", auth.user.id).eq("sync_version", connection.sync_version),
      ]);
      return errorResponse(code, code === "yahoo_access_denied" ? 401 : 503);
    }
  } catch (error) {
    const code = error instanceof Error && error.message.startsWith("yahoo_") ? error.message : "yahoo_sync_failed";
    return errorResponse(code, code === "yahoo_access_denied" ? 401 : 503);
  } finally {
    await auth.adminClient
      .from("provider_connections")
      .update({ sync_lock_until: null, updated_at: new Date().toISOString() })
      .eq("id", connection.id)
      .eq("user_id", auth.user.id)
      .eq("sync_version", connection.sync_version);
  }
}
