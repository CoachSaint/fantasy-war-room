# Fantasy War Room

A league-aware fantasy football decision assistant built around four high-value workflows: **Today, Draft, Lineup, Waivers**.

The product principle is simple: **the scoring engine decides; AI explains**. Recommendations are based on normalized structured inputs and must include freshness, confidence, and evidence.

## Stack
- Next.js App Router + TypeScript
- Tailwind CSS
- Supabase/Postgres
- Vercel deploy + protected daily Cron
- Sleeper adapter for first league integration
- nflverse/open data adapter for stats/injuries/depth chart inputs
- pluggable news intelligence adapter

## Quick start
```bash
cp .env.example .env.local
npm install
npm run dev
```
The starter runs in demo mode without credentials. Commit the generated lockfile immediately after the first install so dependency versions are pinned.

## Environment
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are browser-safe Supabase values. `SUPABASE_SERVICE_ROLE_KEY` and `CRON_SECRET` are server-only.

Vercel calls `/api/scout/run` daily from `vercel.json`. The route requires `Authorization: Bearer $CRON_SECRET` in production.

## Product routes
- `/today` — Daily Brief and recommended actions
- `/draft` — Draft board + best pick/value/upside
- `/lineup` — Start/sit and lineup decisions
- `/waivers` — Add/drop and FAAB decisions
- `/players` — player intelligence explorer

## Internal contracts
See:
- `docs/PRODUCT_SPEC.md`
- `docs/ARCHITECTURE.md`
- `docs/DECISION_ENGINE.md`
- `docs/SCOUT_AGENT.md`
- `docs/BUILD_ORDER.md`

## First integration order
1. Sleeper identity + league import
2. nflverse player/stat/injury normalization
3. persistence + snapshot jobs
4. news evidence extraction
5. AI explanation layer

Do not block the UI on provider completion: keep demo fixtures available until each adapter is validated.
