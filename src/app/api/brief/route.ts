import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().uuid() });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return errorResponse("invalid_query", 400);
  const { leagueId } = parsed.data;
  const access = await authorizeLeagueAccess(request, leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);

  const latest = await access.auth.adminClient.from("daily_briefs")
    .select("id, league_id, season, week, payload, computed_at, fresh_until, engine_version")
    .eq("league_id", leagueId).eq("user_id", access.auth.user.id)
    .order("computed_at", { ascending: false }).limit(1).maybeSingle();
  if (latest.error) return errorResponse("brief_unavailable", 503);
  if (!latest.data) return NextResponse.json({ ok: true, status: "not_ready", data: null });
  const payload = latest.data.payload;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)
    || !Array.isArray((payload as Record<string, unknown>).changes)
    || !Array.isArray((payload as Record<string, unknown>).actions)) {
    return errorResponse("brief_invalid", 503);
  }
  const stale = new Date(String(latest.data.fresh_until)).getTime() <= Date.now();
  return NextResponse.json({
    ok: true, status: stale ? "stale" : "ready", stale,
    data: {
      id: String(latest.data.id), leagueId, season: Number(latest.data.season), week: Number(latest.data.week),
      computedAt: String(latest.data.computed_at), freshUntil: String(latest.data.fresh_until),
      engineVersion: String(latest.data.engine_version), payload,
    },
  });
}
