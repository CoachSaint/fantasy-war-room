-- Read-only Yahoo pick history, scoped to the league and the team that made
-- each pick. Import runs write these rows only after a complete provider fetch.
create table if not exists public.league_draft_picks (
  league_id uuid not null references public.leagues(id) on delete cascade,
  provider_team_key text not null,
  overall_pick int not null check (overall_pick between 1 and 1000),
  round int not null check (round between 1 and 100),
  provider_player_key text not null,
  player_name text,
  player_position text,
  observed_at timestamptz not null,
  primary key (league_id, overall_pick),
  unique (league_id, provider_player_key)
);

create index if not exists idx_league_draft_picks_team
  on public.league_draft_picks (league_id, provider_team_key, overall_pick);

alter table public.league_draft_picks enable row level security;
create policy "league members read draft history" on public.league_draft_picks
  for select to authenticated using (public.can_access_league(league_id));
