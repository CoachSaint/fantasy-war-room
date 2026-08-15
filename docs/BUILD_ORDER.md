# Build Order / Handoff

## Milestone 0 — repo boots
- install dependencies and commit lockfile
- copy `.env.example`
- `npm run build`
- deploy demo shell to Vercel

## Milestone 1 — UI contract
- finish app shell + navigation
- render Today/Draft/Lineup/Waivers/Players from demo fixtures
- create loading, empty, stale, and error states

## Milestone 2 — canonical data
- implement Sleeper read adapter
- implement player ID map
- implement nflverse ingestion adapter
- validate that all provider objects normalize to `src/lib/types.ts`

## Milestone 3 — database
- run migration
- auth + RLS validation
- persistence repositories
- snapshot/evidence/recommendation query functions

## Milestone 4 — scoring
- feature extraction
- deterministic scores
- confidence calculation
- add regression fixtures to tests

## Milestone 5 — Scout
- protected daily cron
- idempotent ingestion
- diffing + Daily Brief materialization
- per-step run status

## Milestone 6 — Ask Coach
Expose narrow tools only:
- `get_team_context`
- `get_player_intel`
- `compare_players`
- `get_best_draft_pick`
- `get_lineup_decisions`
- `get_waiver_moves`
- `get_daily_changes`

The LLM receives structured outputs and evidence, then explains them. It does not query raw provider APIs directly.

## Beta release gate
- build/test green
- RLS tests complete
- Scout can rerun safely without duplicate evidence
- stale data visibly flagged
- provider outage does not blank the app
- core recommendation output is source-backed
- mobile surfaces pass manual touch/overflow review
