import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../supabase/migrations/0002_workspace_learning.sql", import.meta.url),
  "utf8",
);

describe("workspace learning migration security contract", () => {
  it("models workspace and league membership with canonical uniqueness", () => {
    expect(migration).toMatch(/create table if not exists public\.workspaces/);
    expect(migration).toMatch(/create table if not exists public\.workspace_members/);
    expect(migration).toMatch(/primary key \(workspace_id, user_id\)/);
    expect(migration).toMatch(/create table if not exists public\.league_memberships/);
    expect(migration).toMatch(/primary key \(league_id, user_id\)/);
    expect(migration).toMatch(/unique \(league_id, roster_id\)/);
    expect(migration).toMatch(/unique \(league_id, provider_user_id\)/);
    expect(migration).toMatch(/alter table public\.players alter column canonical_key set not null/);
    expect(migration).toMatch(/create unique index if not exists idx_players_canonical_key on public\.players\(canonical_key\)/);
  });

  it("enables RLS and scopes membership reads through access functions", () => {
    expect(migration).toMatch(/alter table public\.workspaces enable row level security/);
    expect(migration).toMatch(/alter table public\.workspace_members enable row level security/);
    expect(migration).toMatch(/alter table public\.league_memberships enable row level security/);
    expect(migration).toMatch(/create policy "members read memberships" on public\.workspace_members for select using \(public\.is_workspace_member\(workspace_id\)\)/);
    expect(migration).toMatch(/create policy "members read league mappings" on public\.league_memberships for select using \(public\.can_access_league\(league_id\)\)/);
    expect(migration).toMatch(/create policy "members read leagues" on public\.leagues for select using \(public\.is_workspace_member\(workspace_id\)\)/);
  });

  it("removes public scout-run reads and requires workspace membership", () => {
    expect(migration).toMatch(/drop policy if exists "scout_runs public read" on public\.scout_runs/);
    expect(migration).toMatch(/create policy "members read scoped scout runs" on public\.scout_runs for select using \(workspace_id is not null and public\.is_workspace_member\(workspace_id\)\)/);
    expect(migration).not.toMatch(/create policy "scout_runs public read"/);
  });

  it("prevents role escalation and cross-league links", () => {
    expect(migration).toMatch(/create policy "owners update memberships"/);
    expect(migration).not.toMatch(/user_id = auth\.uid\(\) and role = 'owner' and public\.is_workspace_creator/);
    expect(migration).toMatch(/foreign key \(roster_id, league_id\) references public\.rosters\(id, league_id\)/);
    expect(migration).toMatch(/foreign key \(slot_definition_id, league_id\) references public\.roster_slot_definitions\(id, league_id\)/);
    expect(migration).toMatch(/foreign key \(recommendation_id, league_id\) references public\.recommendations\(id, league_id\)/);
  });

  it("records prediction evidence cutoff as an immutable temporal boundary", () => {
    expect(migration).toMatch(/evidence_cutoff_at timestamptz not null/);
    expect(migration).toMatch(/check \(evidence_cutoff_at <= created_at\)/);
    expect(migration).toMatch(/create policy "users create own predictions"/);
  });
});
