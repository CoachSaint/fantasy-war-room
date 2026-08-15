# Local Agent Build Contract

## Mission
Ship a fast, evidence-backed fantasy football decision product. Do not turn this repo into a generic sports dashboard or a chat-first toy.

## Hard constraints
- Maximum 3 local agents at once.
- Keep total local machine utilization at or below ~60%.
- One agent owns one lane at a time; do not edit another lane without a handoff note.
- Never couple UI components to raw provider payloads. Normalize first.
- AI explains/reconciles recommendations. Deterministic scoring produces the recommendation payload.
- Every actionable recommendation must carry `confidence`, `freshness`, and `evidenceIds`.
- Prefer boring, deployable infrastructure over clever infrastructure.
- Keep secrets server-only. Never expose service-role or news-provider keys to the browser.

## Suggested 3-agent split
### Agent A — Product/UI
Owns `src/app/**` and `src/components/**`.
Deliver: Today, Draft, Lineup, Waivers, Players surfaces, mobile nav, loading/empty/error states, accessibility, responsive polish.

### Agent B — Data + Decision Engine
Owns `src/lib/data/**`, `src/lib/engine/**`, provider normalization, tests.
Deliver: Sleeper adapter, nflverse adapter, score inputs, WAR/draft/start/waiver scoring, freshness logic, evidence contract.

### Agent C — Platform + Scout
Owns Supabase migrations, auth/RLS, `/api/**`, cron/Scout orchestration and deploy config.
Deliver: persistence, protected Scout job, daily snapshots, recommendation materialization, observability.

## Merge gate
A lane is not done unless:
1. `npm test` passes.
2. `npm run build` passes.
3. No provider-specific object leaks into UI props.
4. New recommendation logic has deterministic tests.
5. User-facing facts include source/evidence IDs and timestamps.
6. Demo mode still renders with no external credentials.

## Do not build yet
- ESPN/Yahoo write integrations
- native mobile app
- payments
- social feed
- dynasty-specific valuation engine
- proprietary ML training pipeline
- automated roster mutation on behalf of the user
