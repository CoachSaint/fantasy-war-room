function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret && process.env.NODE_ENV !== "production") return true;
  return request.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const startedAt = new Date().toISOString();

  // TODO(agent-platform): replace this stub with the deterministic Scout pipeline.
  // Each ingestion step should record its own success/failure and remain rerunnable.
  const steps = [
    { name: "league", status: "stub" },
    { name: "stats", status: "stub" },
    { name: "injuries", status: "stub" },
    { name: "news", status: "stub" },
    { name: "score", status: "stub" },
    { name: "diff", status: "stub" },
  ];

  return Response.json({
    ok: true,
    startedAt,
    finishedAt: new Date().toISOString(),
    steps,
  });
}
