# Architecture

```text
Next.js UI
   │
   ├── Server Components / Route Handlers
   │
Decision Services ───────── Ask Coach tool layer
   │
Normalization boundary
   ├── Sleeper adapter
   ├── nflverse adapter
   └── News adapter
   │
Supabase/Postgres
   ├── canonical players / IDs
   ├── league + roster state
   ├── snapshots
   ├── evidence
   ├── scores
   └── recommendations
   │
Scout daily cron + on-demand refresh
```

## Boundary rule
Provider schemas stop inside `src/lib/data`. Everything beyond that layer consumes canonical types from `src/lib/types.ts`.

## Request model
Server Components should call service functions directly when possible instead of calling the app's own Route Handlers. Route Handlers exist for client mutations, cron, integration callbacks, and externally callable API boundaries.

## Persistence model
Global intelligence is shared where safe (players, public evidence, NFL snapshots). League/team/roster state is user-scoped and protected with RLS.

## Freshness model
Every snapshot and evidence row has `observedAt`. Every derived recommendation has `computedAt` and `freshUntil`. Rendering code must visibly flag stale recommendations rather than silently treating them as current.

## Scout model
Scout is an orchestrator, not an LLM agent loop. Steps are deterministic:
1. ingest
2. normalize
3. dedupe
4. persist evidence
5. derive features
6. score
7. diff against previous snapshot
8. materialize recommendations
9. optionally ask an LLM to summarize the structured delta

## Failure isolation
A failed news provider must not prevent stats refresh. A failed explanation call must not delete or invalidate deterministic recommendations. Each ingestion step records status independently.
