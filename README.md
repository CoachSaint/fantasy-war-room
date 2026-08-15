# Fantasy War Room

A league-aware fantasy football decision assistant built around four high-value workflows: **Today, Draft, Lineup, Waivers**.

The product principle is simple: **the scoring engine decides; AI explains**. Recommendations are based on normalized structured inputs and must include freshness, confidence, and evidence.

Current distribution status: **protected demo / integration candidate, not a fully live production service**. The UI, validation contracts, security boundaries, deterministic scoring helpers, and provider adapters are implemented. A live league requires owner provisioning, Supabase migrations and credentials, authenticated membership data, provider synchronization, canonical player materialization, and a successful end-to-end deployment check. See [docs/IMPLEMENTATION_STATUS.md](docs/IMPLEMENTATION_STATUS.md).

## Stack
- Next.js App Router + TypeScript
- Tailwind CSS
- Supabase/Postgres
- Vercel deploy + protected daily Cron
- Sleeper adapter for first league integration
- Credential-gated, read-only Yahoo Fantasy OAuth and roster import
- nflverse/open data adapter for stats/injuries/depth chart inputs
- pluggable news intelligence adapter

## Quick start
```bash
cp .env.example .env.local
npm install
npm run dev
```
The starter runs in demo mode without credentials. Commit the generated lockfile immediately after the first install so dependency versions are pinned.

Run the local gates before distribution:

```bash
npm test
npm run lint
npm run build
```

## Environment
`NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are browser-safe Supabase values. `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `OPENROUTER_API_KEY`, and every `YAHOO_*` credential/key are server-only. `NFLVERSE_RELEASE_BASE_URL` is optional and defaults to the official release-asset base. Names and blank-value examples are in [.env.example](.env.example); no credential values belong in Git.

Vercel calls `/api/scout/run` daily from `vercel.json` at `0 12 * * *`. The route requires an exact `Authorization: Bearer $CRON_SECRET` header and returns an explicit degraded `503` until Supabase persistence and the real league/materialization pipeline are configured. See [docs/DISTRIBUTION.md](docs/DISTRIBUTION.md).

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
- `docs/SECURITY.md`
- `docs/DISTRIBUTION.md`
- `docs/IMPLEMENTATION_STATUS.md`
- `docs/YAHOO_INTEGRATION.md`

## First integration order
1. Sleeper identity + league import or read-only Yahoo OAuth import
2. nflverse player/stat/injury normalization
3. persistence + snapshot jobs
4. news evidence extraction
5. AI explanation layer

Do not represent demo fixtures as live league intelligence. Demo responses must say `demo: true` and identify fixture data; connected responses must require league identity and membership. Keep demo fixtures available as an explicit preview while each adapter and persistence path is validated.
