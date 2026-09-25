import { NextResponse } from "next/server";
import { z } from "zod";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { errorResponse } from "@/lib/security/http";
import { getYahooDraftBoard, YahooDraftBoardError } from "@/lib/services/yahoo-draft-board";

export const dynamic = "force-dynamic";
const querySchema = z.object({ leagueId: z.string().uuid() });

export async function GET(request: Request) {
  const parsed = querySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return errorResponse("invalid_query", 400);
  const access = await authorizeLeagueAccess(request, parsed.data.leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);
  try {
    return NextResponse.json(await getYahooDraftBoard(access.auth.adminClient,
      parsed.data.leagueId, access.auth.user.id));
  } catch (error) {
    if (error instanceof YahooDraftBoardError) return errorResponse(error.code, error.status);
    return errorResponse("draft_board_unavailable", 503);
  }
}
