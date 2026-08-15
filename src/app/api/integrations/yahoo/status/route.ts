import { NextResponse } from "next/server";
import { getAuthenticatedRequest, hasAdminCredentials } from "@/lib/supabase/admin";
import { yahooIntegrationConfigured } from "@/lib/integrations/yahoo-oauth";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!yahooIntegrationConfigured()) {
    return NextResponse.json({ ok: true, configured: false, connected: false, status: "awaiting_credentials" });
  }
  if (!hasAdminCredentials()) return errorResponse("supabase_unavailable", 503, { configured: true, connected: false });
  let auth;
  try {
    auth = await getAuthenticatedRequest(request);
  } catch {
    return errorResponse("authentication_unavailable", 503, { configured: true, connected: false });
  }
  if (!auth) return errorResponse("authentication_required", 401, { configured: true, connected: false });

  const [connection, links] = await Promise.all([
    auth.adminClient.from("provider_connections").select("id, status, expires_at, last_synced_at, error_code, updated_at").eq("user_id", auth.user.id).eq("provider", "yahoo").maybeSingle(),
    auth.adminClient.from("provider_league_links").select("provider_league_id, provider_team_id, league_id, roster_id, last_synced_at").eq("user_id", auth.user.id).eq("provider", "yahoo"),
  ]);
  if (connection.error || links.error) {
    const missingMigration = connection.error?.code === "42P01" || links.error?.code === "42P01";
    return errorResponse(missingMigration ? "yahoo_migration_required" : "yahoo_status_unavailable", 503, { configured: true, connected: false });
  }
  if (!connection.data) {
    return NextResponse.json({ ok: true, configured: true, connected: false, status: "ready_to_connect", leagues: [] });
  }
  return NextResponse.json({
    ok: true,
    configured: true,
    connected: connection.data.status === "connected",
    status: connection.data.status,
    expiresAt: connection.data.expires_at,
    lastSyncedAt: connection.data.last_synced_at,
    error: connection.data.error_code,
    leagues: links.data || [],
  });
}

export async function DELETE(request: Request) {
  if (!yahooIntegrationConfigured()) return errorResponse("yahoo_credentials_pending", 503);
  if (!hasAdminCredentials()) return errorResponse("supabase_unavailable", 503);
  let auth;
  try {
    auth = await getAuthenticatedRequest(request);
  } catch {
    return errorResponse("authentication_unavailable", 503);
  }
  if (!auth) return errorResponse("authentication_required", 401);
  const result = await auth.adminClient.from("provider_connections").delete().eq("user_id", auth.user.id).eq("provider", "yahoo");
  if (result.error) return errorResponse(result.error.code === "42P01" ? "yahoo_migration_required" : "yahoo_disconnect_failed", 503);
  return NextResponse.json({ ok: true, configured: true, connected: false, status: "disconnected" });
}
