# Scout — Daily Intelligence Contract

## Purpose
Produce a reliable delta of fantasy-relevant information and refresh deterministic recommendations.

## Daily run
1. Create `scout_runs` record.
2. Pull configured provider datasets.
3. Normalize player identities.
4. Persist new snapshots/evidence using idempotency keys.
5. Recompute affected player feature vectors.
6. Recompute affected scores.
7. Diff against latest previous snapshot.
8. Materialize league/team-specific actions.
9. Save a Daily Brief payload.
10. Mark each step independently success/failed.

## On-demand refresh
Used before a high-stakes interaction (for example lineup review). Apply provider cooldowns and return the newest existing snapshot if no refresh is necessary.

## Evidence object
```ts
{
  playerId: string;
  type: "injury" | "depth_chart" | "usage" | "transaction" | "news" | "projection";
  source: string;
  sourceUrl?: string;
  observedAt: string;
  publishedAt?: string;
  confidence: number;
  summary: string;
  fingerprint: string;
}
```

## News rules
- prefer primary/official and reputable reporting
- store summary and URL, not copied articles
- dedupe syndicated or repeated reports
- distinguish report time from event time
- contradictions create multiple evidence records and lower confidence

## Run safety
`/api/scout/run` must verify `CRON_SECRET` in production. Use service-role DB access server-side only. Record run duration and failed step names. Never expose provider secrets in the Scout response body.
