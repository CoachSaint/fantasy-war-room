import { NextResponse } from "next/server";
import { z } from "zod";
import {
  leagueSetupInputSchema,
  verifyLeagueSetup,
  type LeagueSetupInput,
} from "@/lib/services/league-setup";
import { getAuthenticatedRequest, hasAdminCredentials } from "@/lib/supabase/admin";
import { persistLeagueSetup, SetupRepositoryError } from "@/lib/supabase/repositories";
import { errorResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const metadataSchema = z.object({
  workspaceId: z.string().uuid().optional(),
  managerId: z.string().trim().min(1).max(200).optional(),
}).strict();

function boundedSetupInput(raw: unknown): { metadata: z.infer<typeof metadataSchema>; setupInput: unknown } | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if ("setup" in value) {
    const parsed = z.object({ setup: leagueSetupInputSchema, ...metadataSchema.shape }).strict().safeParse(value);
    if (!parsed.success) return null;
    return { metadata: { workspaceId: parsed.data.workspaceId, managerId: parsed.data.managerId }, setupInput: parsed.data.setup };
  }
  const { workspaceId, managerId, ...setupInput } = value;
  const metadata = metadataSchema.safeParse({ workspaceId, managerId });
  if (!metadata.success) return null;
  return { metadata: metadata.data, setupInput };
}

export async function POST(request: Request) {
  if (!hasAdminCredentials()) return errorResponse("supabase_unavailable", 503);

  let raw: unknown;
  try {
    const text = await request.text();
    if (text.length > 500_000) return errorResponse("setup_payload_too_large", 413);
    raw = JSON.parse(text) as unknown;
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const bounded = boundedSetupInput(raw);
  if (!bounded) return errorResponse("invalid_setup_request", 400);
  const verification = verifyLeagueSetup(bounded.setupInput);
  if (!verification.ok || !verification.canonical) {
    return NextResponse.json({ ok: false, status: "error", error: "invalid_setup", issues: verification.errors.map((issue) => ({ code: issue.code, path: issue.path, message: issue.message })) }, { status: 400 });
  }

  const setup = verification.canonical;
  if (setup.teams.length > 32 || setup.managers.length > 64 || setup.rosterSlots.length > 128 || setup.knownPlayerIds.length > 10_000 || setup.playerAssignments.length > 10_000) {
    return errorResponse("setup_limits_exceeded", 413);
  }

  let auth;
  try {
    auth = await getAuthenticatedRequest(request);
  } catch {
    return errorResponse("authentication_unavailable", 503);
  }
  if (!auth) return errorResponse("authentication_required", 401);

  try {
    const result = await persistLeagueSetup(auth.adminClient, auth.user.id, setup, bounded.metadata);
    return NextResponse.json({ ok: true, status: "ready", data: { ...result, setupRequired: false } }, { status: 201 });
  } catch (error) {
    if (error instanceof SetupRepositoryError) return errorResponse(error.code, error.status);
    return errorResponse("setup_persistence_failed", 503);
  }
}

export type LeagueSetupRouteInput = LeagueSetupInput;
