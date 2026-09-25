-- Preserve Yahoo's status=A;sort=OR response order for a source-labeled
-- draft candidate board. It is the provider list order, not a player score.
alter table public.league_available_players
  add column if not exists provider_order int check (provider_order between 1 and 200);

create unique index if not exists idx_league_available_provider_order
  on public.league_available_players (league_id, scan_id, provider_order)
  where provider_order is not null;
