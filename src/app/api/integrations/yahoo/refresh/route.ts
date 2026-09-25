import { NextResponse } from "next/server";
import { createAdminClient, hasAdminCredentials } from "@/lib/supabase/admin";
import { yahooIntegrationConfigured } from "@/lib/integrations/yahoo-oauth";
import { runYahooSync } from "@/lib/integrations/yahoo-runner";
import { cronAuthorized } from "@/lib/security/cron";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

/** Bounded scheduled refresh of existing, user-consented Yahoo connections. */
export async function POST(request: Request) {
  if (!process.env.CRON_SECRET) return errorResponse("cron_secret_unconfigured", 503);
  if (!cronAuthorized(request)) return errorResponse("unauthorized", 401);
  if (!yahooIntegrationConfigured()) return errorResponse("yahoo_credentials_pending", 503);
  if (!hasAdminCredentials()) return errorResponse("supabase_unavailable", 503);

  let adminClient: ReturnType<typeof createAdminClient>;
  try {
    adminClient = createAdminClient();
  } catch {
    return errorResponse("supabase_unavailable", 503);
  }
  const connections = await adminClient.from("provider_connections")
    .select("user_id")
    .eq("provider", "yahoo")
    .in("status", ["connected", "error"])
    .order("last_synced_at", { ascending: true, nullsFirst: true })
    .limit(11);
  if (connections.error) return errorResponse("yahoo_connection_unavailable", 503);
  if ((connections.data || []).length > 10) return errorResponse("yahoo_connection_limit_exceeded", 503);
  if (!connections.data?.length) {
    return NextResponse.json({ ok: true, status: "no_consented_connections", connectionsProcessed: 0 });
  }

  let completed = 0;
  let partial = 0;
  let inProgress = 0;
  const errors: Record<string, number> = {};
  for (const connection of connections.data) {
    try {
      const response = await runYahooSync(adminClient, String(connection.user_id));
      const body = await response.json() as { error?: string; data?: { leaguesProcessed?: number } };
      if (response.ok) completed += 1;
      else if (response.status === 409 && body.error === "yahoo_sync_in_progress") inProgress += 1;
      else {
        partial += typeof body.data?.leaguesProcessed === "number" ? 1 : 0;
        const code = typeof body.error === "string" ? body.error : "yahoo_refresh_failed";
        errors[code] = (errors[code] || 0) + 1;
      }
    } catch {
      errors.yahoo_refresh_failed = (errors.yahoo_refresh_failed || 0) + 1;
    }
  }
  const degraded = Object.keys(errors).length > 0;
  return NextResponse.json({
    ok: !degraded, status: degraded ? "degraded" : inProgress ? "in_progress" : "completed",
    connectionsProcessed: connections.data.length, completed, partial, inProgress, errors,
  }, { status: degraded ? 503 : 200 });
}
