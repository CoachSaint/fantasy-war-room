import { NextResponse } from "next/server";
import { z } from "zod";
import { demoRecommendations } from "@/lib/demo";
import { authorizeLeagueAccess } from "@/lib/supabase/admin";
import { clientKey, consumeRateLimit, errorResponse, rateLimitResponse } from "@/lib/security/http";

export const dynamic = "force-dynamic";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const MODEL = "deepseek/deepseek-v4-pro";

const messageSchema = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string().trim().min(1).max(2_000),
}).strict();

const requestSchema = z.object({
  messages: z.array(messageSchema).min(1).max(20),
  leagueId: z.string().uuid().optional(),
  demo: z.boolean().optional().default(false),
}).strict().superRefine((value, context) => {
  const totalChars = value.messages.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars > 8_000) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["messages"], message: "message history is too large" });
  }
  const last = value.messages[value.messages.length - 1];
  if (last?.role !== "user") {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["messages"], message: "latest message must be from user" });
  }
});

function demoReply(): string {
  const top = demoRecommendations[0];
  return `Demo Coach (fixture data): ${top.headline} WAR Score ${top.score}/100 with ${top.confidence}% confidence. Evidence is demo-only; connect a league to receive current advice.`;
}

function providerContext(recommendations: Array<Record<string, unknown>>, evidence: Array<Record<string, unknown>>): string {
  return [
    "CURRENT LEAGUE RECOMMENDATIONS:",
    ...recommendations.map((row) => `${String(row.kind).toUpperCase()} ${String(row.headline)} (${String(row.score)}/100, ${String(row.confidence)}% confidence; computed ${String(row.computed_at)}; fresh until ${String(row.fresh_until)}; evidence ${Array.isArray(row.evidence_ids) ? row.evidence_ids.join(", ") : "none"})`),
    "CURRENT EVIDENCE:",
    ...evidence.map((row) => `${String(row.type)} from ${String(row.source)}: ${String(row.summary)}`),
  ].join("\n");
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return errorResponse("invalid_json", 400);
  }

  const parsed = requestSchema.safeParse(body);
  if (!parsed.success) {
    return errorResponse("invalid_coach_request", 400, { issues: parsed.error.issues.map((issue) => issue.path.join(".")) });
  }

  const { messages, leagueId, demo } = parsed.data;
  if (demo) return NextResponse.json({ reply: demoReply(), modelUsed: "demo", source: "demo-fixture", demo: true });
  if (!leagueId) return errorResponse("league_id_required", 400);

  const access = await authorizeLeagueAccess(request, leagueId);
  if (!access.ok) return errorResponse(access.error, access.status);

  const limit = consumeRateLimit(clientKey(request, access.auth.user.id), { limit: 10, windowMs: 60_000 });
  if (!limit.allowed) return rateLimitResponse(limit.retryAfterSeconds);

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) return errorResponse("coach_provider_unavailable", 503);

  try {
    const now = new Date().toISOString();
    const recommendationQuery = await access.auth.adminClient
      .from("recommendations")
      .select("kind, headline, score, confidence, evidence_ids, computed_at, fresh_until")
      .eq("league_id", leagueId)
      .or(`user_id.is.null,user_id.eq.${access.auth.user.id}`)
      .lte("computed_at", now)
      .gt("fresh_until", now)
      .order("score", { ascending: false })
      .limit(50);
    if (recommendationQuery.error) return errorResponse("league_context_unavailable", 503);

    const recommendations = (recommendationQuery.data || []) as Array<Record<string, unknown>>;
    if (recommendations.length === 0) return errorResponse("league_context_unavailable", 503);

    const evidenceIds = Array.from(new Set(recommendations.flatMap((row) => Array.isArray(row.evidence_ids) ? row.evidence_ids.map(String) : []))).slice(0, 100);
    let evidence: Array<Record<string, unknown>> = [];
    if (evidenceIds.length > 0) {
      const evidenceQuery = await access.auth.adminClient
        .from("evidence")
        .select("type, source, summary")
        .in("id", evidenceIds)
        .limit(100);
      if (evidenceQuery.error) return errorResponse("league_context_unavailable", 503);
      evidence = (evidenceQuery.data || []) as Array<Record<string, unknown>>;
    }

    const systemPrompt = `You are Fantasy War Room Coach. Deterministic code produces recommendation scores; you explain only the supplied, current league evidence. Never invent stats, injuries, rankings, or live facts. If evidence is insufficient, say so.\n\n${providerContext(recommendations, evidence)}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 12_000);
    let response: Response;
    try {
      response = await fetch(OPENROUTER_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
          "HTTP-Referer": process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000",
          "X-Title": "Fantasy War Room",
        },
        signal: controller.signal,
        body: JSON.stringify({ model: MODEL, messages: [{ role: "system", content: systemPrompt }, ...messages], max_tokens: 600, temperature: 0.3 }),
      });
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) return errorResponse("coach_provider_error", 502);
    const providerBody = await response.json() as { choices?: Array<{ message?: { content?: unknown; reasoning?: unknown } }> };
    const content = providerBody.choices?.[0]?.message?.content || providerBody.choices?.[0]?.message?.reasoning;
    if (typeof content !== "string" || !content.trim()) return errorResponse("coach_provider_invalid_response", 502);

    return NextResponse.json({ reply: content.trim(), modelUsed: MODEL, source: "openrouter", demo: false });
  } catch (error) {
    console.warn("Coach provider request failed", error instanceof Error ? error.name : "unknown_error");
    return errorResponse("coach_provider_unavailable", 503);
  }
}
