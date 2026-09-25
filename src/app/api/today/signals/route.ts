import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";
import { getTodaySignals, TodaySignalsError } from "@/lib/services/today-signals";

export const dynamic = "force-dynamic";
const querySchema = z.object({ leagueId: z.string().uuid() });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return errorResponse("invalid_query", 400);
  const access = await authorizeLeagueAccess(request, parsed.data.leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);
  try {
    return NextResponse.json(await getTodaySignals(access.auth.adminClient,
      parsed.data.leagueId, access.auth.user.id));
  } catch (error) {
    if (error instanceof TodaySignalsError) return errorResponse(error.code, error.status);
    return errorResponse("today_signals_unavailable", 503);
  }
}
