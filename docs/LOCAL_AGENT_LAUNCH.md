# Local Agent Launch Prompt

You are taking over implementation of **Fantasy War Room** from an approved architecture. Read these files before editing:

1. `AGENTS.md`
2. `docs/PRODUCT_SPEC.md`
3. `docs/ARCHITECTURE.md`
4. `docs/DECISION_ENGINE.md`
5. `docs/SCOUT_AGENT.md`
6. `docs/BUILD_ORDER.md`
7. `src/lib/types.ts`
8. `supabase/migrations/0001_initial.sql`

## Objective
Take the scaffold to a deployable private beta while preserving one non-negotiable architecture rule:

> Deterministic code produces recommendation payloads; AI explains them using current evidence.

Do not redesign the architecture before proving a real blocker.

## Coordination
Run at most three implementation lanes concurrently.

### Lane A — UI/UX
- own `src/app/**`, `src/components/**`, styling
- preserve Apple-clean visual direction: typography, spacing, restrained glass, minimal chrome
- create responsive desktop/mobile states
- wire surfaces only to canonical app types/services
- build first-class stale/loading/empty/error states
- do not create generic dashboard-card clutter

### Lane B — Data/Engine
- own `src/lib/data/**`, `src/lib/engine/**`, deterministic tests
- finish Sleeper adapter + normalization
- add canonical player-ID resolution
- implement nflverse-backed snapshots/evidence behind existing adapter interface
- implement feature extraction and versioned scoring
- implement confidence/freshness calculation
- add fixture/regression tests

### Lane C — Platform/Scout
- own Supabase, RLS/auth, repositories, `src/app/api/**`, deploy config
- apply/test migration
- implement protected Scout pipeline with idempotent evidence/snapshot writes
- record per-step failures without killing unrelated ingestion paths
- materialize Today/recommendation payloads
- deploy demo first, live data second

## Priority order
P0: project installs/builds/tests and demo deploy works.
P1: Sleeper league import + roster identity.
P2: canonical player map + current data ingestion.
P3: deterministic draft/start/waiver scoring.
P4: Today diff + Scout persistence.
P5: Ask Coach tool layer.
P6: visual polish and Sunday refresh behavior.

## Provider guardrails
- Sleeper full `/players/nfl` is a large player-map request intended for infrequent refresh. Cache/persist it and do not call it on page render.
- Use provider filtering where appropriate and normalize IDs immediately.
- nflverse data access belongs behind `NflverseAdapter`; the UI must not care whether the implementation is Python-backed, direct release ingestion, or another server-side mechanism.
- News facts require source URL, observed/published times where available, confidence, and dedupe fingerprint.

## Definition of done for any recommendation
A recommendation is invalid unless it has:
- score
- confidence
- computed timestamp
- freshness expiry
- reason codes
- evidence IDs
- engine version

## Ask Coach constraints
Ask Coach must call structured internal tools. Never let the model independently invent rankings, projections, injury states, roster availability, or waiver status.

## End-of-lane handoff
Write a concise handoff containing:
- files changed
- tests/build status
- unresolved blockers
- any schema/contract changes
- next recommended action

Do not leave hidden architectural decisions only in chat/session context; update repo docs when a durable contract changes.
