-- Fantasy War Room v0.1
create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now()
);

create table if not exists public.leagues (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider in ('sleeper','manual')),
  provider_league_id text,
  name text not null,
  season int not null,
  current_week int not null default 1,
  scoring jsonb not null default '{}'::jsonb,
  roster_positions jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, provider, provider_league_id)
);

create table if not exists public.players (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  team text,
  position text not null,
  status text,
  birth_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.player_id_map (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  provider text not null,
  provider_player_id text not null,
  created_at timestamptz not null default now(),
  unique(provider, provider_player_id)
);

create table if not exists public.rosters (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  provider_roster_id text,
  owner_user_id uuid references auth.users(id) on delete set null,
  name text,
  player_ids uuid[] not null default '{}',
  starter_ids uuid[] not null default '{}',
  updated_at timestamptz not null default now(),
  unique(league_id, provider_roster_id)
);

create table if not exists public.player_snapshots (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  season int not null,
  week int not null,
  data jsonb not null,
  observed_at timestamptz not null,
  source text not null,
  fingerprint text not null,
  created_at timestamptz not null default now(),
  unique(source, fingerprint)
);

create table if not exists public.evidence (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references public.players(id) on delete cascade,
  type text not null,
  source text not null,
  source_url text,
  summary text not null,
  confidence numeric(5,2) not null check (confidence >= 0 and confidence <= 100),
  published_at timestamptz,
  observed_at timestamptz not null,
  fingerprint text not null unique,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.player_scores (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  league_id uuid references public.leagues(id) on delete cascade,
  kind text not null check (kind in ('draft','start','waiver','overall')),
  score int not null check (score between 0 and 100),
  confidence int not null check (confidence between 0 and 100),
  engine_version text not null,
  features jsonb not null,
  computed_at timestamptz not null,
  fresh_until timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.recommendations (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  roster_id uuid references public.rosters(id) on delete cascade,
  kind text not null,
  subject_player_id uuid not null references public.players(id) on delete cascade,
  alternative_player_id uuid references public.players(id) on delete set null,
  score int not null check (score between 0 and 100),
  confidence int not null check (confidence between 0 and 100),
  headline text not null,
  reason_codes text[] not null default '{}',
  evidence_ids uuid[] not null default '{}',
  engine_version text not null,
  computed_at timestamptz not null,
  fresh_until timestamptz not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.scout_runs (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'running',
  trigger text not null default 'cron',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  steps jsonb not null default '[]'::jsonb,
  error text,
  created_at timestamptz not null default now()
);

create index if not exists idx_snapshots_player_time on public.player_snapshots(player_id, observed_at desc);
create index if not exists idx_evidence_player_time on public.evidence(player_id, observed_at desc);
create index if not exists idx_scores_league_kind on public.player_scores(league_id, kind, score desc);
create index if not exists idx_recommendations_league_time on public.recommendations(league_id, computed_at desc);

alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.rosters enable row level security;
alter table public.players enable row level security;
alter table public.player_id_map enable row level security;
alter table public.player_snapshots enable row level security;
alter table public.evidence enable row level security;
alter table public.player_scores enable row level security;
alter table public.recommendations enable row level security;

create policy "profiles own row" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "leagues owner access" on public.leagues for all using (auth.uid() = owner_id) with check (auth.uid() = owner_id);
create policy "rosters via league owner" on public.rosters for all using (
  exists (select 1 from public.leagues l where l.id = league_id and l.owner_id = auth.uid())
) with check (
  exists (select 1 from public.leagues l where l.id = league_id and l.owner_id = auth.uid())
);

-- Global intelligence is read-only to authenticated users. Service-role jobs write it.
create policy "players auth read" on public.players for select to authenticated using (true);
create policy "player map auth read" on public.player_id_map for select to authenticated using (true);
create policy "snapshots auth read" on public.player_snapshots for select to authenticated using (true);
create policy "evidence auth read" on public.evidence for select to authenticated using (true);

create policy "scores via league owner or global" on public.player_scores for select using (
  league_id is null or exists (select 1 from public.leagues l where l.id = league_id and l.owner_id = auth.uid())
);
create policy "recommendations via league owner" on public.recommendations for select using (
  exists (select 1 from public.leagues l where l.id = league_id and l.owner_id = auth.uid())
);
