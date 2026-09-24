-- Current-week Yahoo head-to-head scoreboard snapshots. No direct client writes.
alter table public.provider_sync_runs add column matchups_processed int not null default 0
  check (matchups_processed >= 0);

create table public.league_week_matchups (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  provider text not null default 'yahoo' check (provider = 'yahoo'),
  week int not null check (week between 1 and 23),
  provider_matchup_key text not null,
  team_a_roster_id uuid not null,
  team_b_roster_id uuid not null,
  team_a_points numeric(10,2),
  team_b_points numeric(10,2),
  team_a_projected_points numeric(10,2),
  team_b_projected_points numeric(10,2),
  winner_roster_id uuid references public.rosters(id) on delete set null,
  status text not null,
  is_tied boolean not null default false,
  is_playoffs boolean not null default false,
  observed_at timestamptz not null,
  unique (league_id, week, provider_matchup_key),
  foreign key (team_a_roster_id, league_id) references public.rosters(id, league_id) on delete cascade,
  foreign key (team_b_roster_id, league_id) references public.rosters(id, league_id) on delete cascade,
  check (team_a_roster_id <> team_b_roster_id),
  check (winner_roster_id is null or winner_roster_id in (team_a_roster_id, team_b_roster_id)),
  check (not is_tied or winner_roster_id is null)
);

create index idx_league_week_matchups_league_week on public.league_week_matchups(league_id, week);
alter table public.league_week_matchups enable row level security;
create policy "league members read weekly matchups" on public.league_week_matchups
  for select to authenticated using (public.can_access_league(league_id));
