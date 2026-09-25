-- Verified Yahoo league-available candidates for bounded waiver decisions.
-- Presence in this table means the player appeared in that league's status=A
-- collection at observed_at; fresh_until prevents stale addability claims.
create table if not exists public.league_available_players (
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  provider_player_key text not null check (provider_player_key ~ '^[0-9]+[.]p[.][0-9]+$'),
  observed_at timestamptz not null,
  fresh_until timestamptz not null,
  primary key (league_id, player_id),
  unique (league_id, provider_player_key),
  check (fresh_until > observed_at)
);

create index if not exists idx_league_available_fresh
  on public.league_available_players (league_id, fresh_until desc);

create table if not exists public.league_available_scans (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  observed_at timestamptz not null,
  fresh_until timestamptz not null,
  candidates_count int not null check (candidates_count between 0 and 200),
  truncated boolean not null default false,
  source_url text not null,
  check (fresh_until > observed_at)
);

alter table public.league_available_players enable row level security;
alter table public.league_available_scans enable row level security;

create policy "league members read fresh availability" on public.league_available_players
  for select using (public.can_access_league(league_id));
create policy "league members read availability scan" on public.league_available_scans
  for select using (public.can_access_league(league_id));

alter table public.provider_sync_runs
  add column if not exists available_players_processed int not null default 0
  check (available_players_processed >= 0);
