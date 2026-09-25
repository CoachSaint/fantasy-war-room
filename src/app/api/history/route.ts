import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const querySchema = z.object({ leagueId: z.string().uuid(), limit: z.coerce.number().int().min(1).max(50).default(20) });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams.entries()));
  if (!parsed.success) return errorResponse("invalid_query", 400);
  const access = await authorizeLeagueAccess(request, parsed.data.leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);
  const { data, error } = await access.auth.adminClient.from("decision_events")
    .select("id, recommendation_id, recommendation_snapshot, alternatives, confidence, response, user_note, recommended_at, responded_at")
    .eq("league_id", parsed.data.leagueId).eq("user_id", access.auth.user.id)
    .order("recommended_at", { ascending: false }).limit(parsed.data.limit);
  if (error) return errorResponse("history_unavailable", 503);
  return NextResponse.json({ data: data || [], count: data?.length || 0, generatedAt: new Date().toISOString() });
}

const responseSchema = z.object({
  leagueId: z.string().uuid(),
  decisionId: z.string().uuid(),
  response: z.enum(["accepted", "ignored", "overridden"]).nullable(),
  note: z.string().trim().max(500).nullable().optional(),
}).strict();

/** Record what the manager says they did; never infer action from advice. */
export async function PATCH(request: Request) {
  let raw: unknown;
  try {
    const body = await request.text();
    if (body.length > 4096) return errorResponse("history_response_too_large", 413);
    raw = JSON.parse(body) as unknown;
  } catch {
    return errorResponse("invalid_json", 400);
  }
  const parsed = responseSchema.safeParse(raw);
  if (!parsed.success || (parsed.data.response === null && parsed.data.note)) {
    return errorResponse("invalid_history_response", 400);
  }
  const { leagueId, decisionId, response, note } = parsed.data;
  const access = await authorizeLeagueAccess(request, leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);

  const updated = await access.auth.adminClient.from("decision_events")
    .update({ response, user_note: response ? note || null : null,
      responded_at: response ? new Date().toISOString() : null })
    .eq("id", decisionId).eq("league_id", leagueId).eq("user_id", access.auth.user.id)
    .select("id, response, user_note, responded_at").maybeSingle();
  if (updated.error) return errorResponse("history_response_unavailable", 503);
  if (!updated.data) return errorResponse("decision_not_found", 404);
  return NextResponse.json({ ok: true, data: updated.data });
}
