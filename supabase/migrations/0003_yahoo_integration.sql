-- Read-only Yahoo Fantasy connection and synchronization metadata.
-- OAuth tokens are encrypted by the server before they reach Postgres.

alter table public.leagues drop constraint if exists leagues_provider_check;
alter table public.leagues add constraint leagues_provider_check
  check (provider in ('sleeper', 'yahoo', 'manual'));

create table if not exists public.provider_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('yahoo')),
  external_user_id text,
  access_token_ciphertext text not null,
  refresh_token_ciphertext text not null,
  expires_at timestamptz not null,
  scopes text[] not null default '{}',
  status text not null default 'connected' check (status in ('connected', 'error', 'revoked')),
  error_code text,
  last_synced_at timestamptz,
  sync_lock_until timestamptz,
  sync_version bigint not null default 0 check (sync_version >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider)
);

alter table public.players add column if not exists identity_status text not null default 'resolved'
  check (identity_status in ('resolved', 'provider_only', 'ambiguous'));

create table if not exists public.provider_identity_queue (
  id uuid primary key default gen_random_uuid(),
  provider text not null check (provider in ('yahoo')),
  provider_player_id text not null,
  player_id uuid not null references public.players(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending', 'resolved', 'rejected')),
  observed_name text not null,
  observed_team text,
  observed_position text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_player_id)
);

create table if not exists public.provider_league_links (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('yahoo')),
  provider_league_id text not null,
  provider_team_id text not null,
  league_id uuid not null references public.leagues(id) on delete cascade,
  roster_id uuid not null references public.rosters(id) on delete cascade,
  last_synced_at timestamptz not null,
  metadata jsonb not null default '{}'::jsonb,
  unique (user_id, provider, provider_league_id, provider_team_id)
);

create table if not exists public.provider_sync_runs (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null references public.provider_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('yahoo')),
  status text not null check (status in ('running', 'completed', 'completed_with_errors', 'failed')),
  leagues_processed int not null default 0 check (leagues_processed >= 0),
  rosters_processed int not null default 0 check (rosters_processed >= 0),
  players_processed int not null default 0 check (players_processed >= 0),
  error_code text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists idx_provider_connections_user on public.provider_connections(user_id, provider);
create index if not exists idx_provider_league_links_user on public.provider_league_links(user_id, provider);
create index if not exists idx_provider_sync_runs_user_time on public.provider_sync_runs(user_id, started_at desc);
create index if not exists idx_provider_identity_queue_status on public.provider_identity_queue(status, created_at);

alter table public.provider_connections enable row level security;
alter table public.provider_league_links enable row level security;
alter table public.provider_sync_runs enable row level security;
alter table public.provider_identity_queue enable row level security;

-- Token rows intentionally have no authenticated-user policy. Only the
-- service-role server boundary can read ciphertext or mutate connections.
-- Identity reconciliation is likewise service-role-only; provider-only players
-- are never silently treated as canonical cross-provider matches.
create policy "users read own provider league links" on public.provider_league_links
  for select using (user_id = auth.uid());
create policy "users read own provider sync runs" on public.provider_sync_runs
  for select using (user_id = auth.uid());
