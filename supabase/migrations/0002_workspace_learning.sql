-- Fantasy War Room v0.2: multi-manager workspaces, exact league structure,
-- auditable predictions, and membership-scoped row-level security.

create table if not exists public.workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 120),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'admin', 'member', 'viewer')),
  display_name text,
  joined_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

alter table public.leagues add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.players add column if not exists canonical_key text;
alter table public.rosters add column if not exists current_faab numeric(10,2);
alter table public.rosters add column if not exists waiver_priority int;
alter table public.rosters add column if not exists wins int not null default 0;
alter table public.rosters add column if not exists losses int not null default 0;
alter table public.rosters add column if not exists ties int not null default 0;
alter table public.rosters add column if not exists metadata jsonb not null default '{}'::jsonb;
alter table public.recommendations add column if not exists user_id uuid references auth.users(id) on delete cascade;
alter table public.scout_runs add column if not exists workspace_id uuid references public.workspaces(id) on delete cascade;
alter table public.scout_runs add column if not exists run_key text;

-- Keep exact scoring rules queryable while retaining leagues.scoring as the
-- provider-compatible JSON payload. A row is one coefficient, not a preset.
create table if not exists public.league_scoring_rules (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  category text not null check (category in ('passing','rushing','receiving','misc','kicking','defense','bonus')),
  stat_key text not null check (char_length(stat_key) between 1 and 80),
  position text not null default '*',
  points numeric(10,4) not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (league_id, category, stat_key, position)
);

update public.players set canonical_key = 'legacy:' || id::text where canonical_key is null;
alter table public.players alter column canonical_key set not null;
create unique index if not exists idx_players_canonical_key on public.players(canonical_key);
create unique index if not exists idx_scout_runs_key on public.scout_runs(run_key) where run_key is not null;

do $$
declare
  owner_record record;
  workspace_uuid uuid;
begin
  for owner_record in select distinct owner_id from public.leagues where workspace_id is null loop
    insert into public.workspaces (name, created_by)
    values ('Imported workspace', owner_record.owner_id)
    returning id into workspace_uuid;

    insert into public.workspace_members (workspace_id, user_id, role)
    values (workspace_uuid, owner_record.owner_id, 'owner')
    on conflict do nothing;

    update public.leagues
      set workspace_id = workspace_uuid
      where owner_id = owner_record.owner_id and workspace_id is null;
  end loop;
end $$;

alter table public.leagues alter column workspace_id set not null;

-- Composite uniqueness is required before scoped foreign keys are declared.
create unique index if not exists idx_rosters_id_league on public.rosters(id, league_id);
create unique index if not exists idx_recommendations_id_league on public.recommendations(id, league_id);

create table if not exists public.league_memberships (
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  roster_id uuid,
  provider_user_id text,
  is_primary boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (league_id, user_id),
  unique (league_id, roster_id),
  unique (league_id, provider_user_id),
  foreign key (roster_id, league_id) references public.rosters(id, league_id) on delete restrict
);

create table if not exists public.manager_preferences (
  user_id uuid not null references auth.users(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  risk_tolerance int not null default 50 check (risk_tolerance between 0 and 100),
  upside_bias int not null default 50 check (upside_bias between 0 and 100),
  floor_bias int not null default 50 check (floor_bias between 0 and 100),
  rookie_aggression int not null default 50 check (rookie_aggression between 0 and 100),
  waiver_aggression int not null default 50 check (waiver_aggression between 0 and 100),
  trade_aggression int not null default 50 check (trade_aggression between 0 and 100),
  qb_strategy text,
  te_strategy text,
  stacking_preference text,
  favorite_teams jsonb not null default '[]'::jsonb,
  avoid_players jsonb not null default '[]'::jsonb,
  notes jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, league_id)
);

create table if not exists public.roster_slot_definitions (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  slot_type text not null check (slot_type in ('QB','RB','WR','TE','FLEX','SUPER_FLEX','WR_RB','WR_TE','K','DST','BENCH','IR','TAXI')),
  slot_order int not null check (slot_order >= 0),
  eligible_positions text[] not null check (cardinality(eligible_positions) > 0),
  required boolean not null default true,
  unique (league_id, slot_order)
);

create unique index if not exists idx_roster_slots_id_league on public.roster_slot_definitions(id, league_id);

create table if not exists public.roster_assignments (
  roster_id uuid not null,
  league_id uuid not null references public.leagues(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete cascade,
  slot_definition_id uuid,
  designation text not null default 'bench' check (designation in ('starter','bench','ir','taxi')),
  added_at timestamptz not null default now(),
  primary key (roster_id, player_id),
  foreign key (roster_id, league_id) references public.rosters(id, league_id) on delete cascade,
  foreign key (slot_definition_id, league_id) references public.roster_slot_definitions(id, league_id) on delete restrict
);

create table if not exists public.prediction_events (
  id uuid primary key default gen_random_uuid(),
  player_id uuid not null references public.players(id) on delete cascade,
  league_id uuid references public.leagues(id) on delete cascade,
  user_id uuid references auth.users(id) on delete cascade,
  prediction_type text not null,
  target_season int not null,
  target_week int not null,
  predicted_mean numeric,
  predicted_floor numeric,
  predicted_ceiling numeric,
  probability numeric check (probability is null or probability between 0 and 1),
  feature_snapshot_id uuid references public.player_snapshots(id) on delete restrict,
  engine_version text not null,
  evidence_cutoff_at timestamptz not null,
  created_at timestamptz not null default now(),
  check (evidence_cutoff_at <= created_at)
);

create table if not exists public.prediction_outcomes (
  prediction_id uuid primary key references public.prediction_events(id) on delete cascade,
  actual_fantasy_points numeric,
  actual_snaps int,
  actual_routes int,
  actual_targets int,
  actual_carries int,
  actual_availability text,
  prediction_error numeric,
  calibration_bucket text,
  finalized_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists public.decision_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  league_id uuid not null references public.leagues(id) on delete cascade,
  recommendation_id uuid not null,
  alternatives jsonb not null default '[]'::jsonb,
  confidence int not null check (confidence between 0 and 100),
  response text check (response is null or response in ('accepted','ignored','overridden')),
  user_note text,
  recommended_at timestamptz not null,
  responded_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (recommendation_id, league_id) references public.recommendations(id, league_id) on delete restrict
);

create table if not exists public.engine_calibration (
  id uuid primary key default gen_random_uuid(),
  engine_version text not null,
  position text,
  prediction_type text not null,
  season_phase text not null,
  confidence_bucket text not null,
  sample_size int not null check (sample_size >= 0),
  mae numeric,
  rmse numeric,
  brier_score numeric,
  interval_coverage numeric,
  rank_correlation numeric,
  decision_win_rate numeric,
  computed_at timestamptz not null default now(),
  unique (engine_version, position, prediction_type, season_phase, confidence_bucket)
);

create table if not exists public.source_performance (
  id uuid primary key default gen_random_uuid(),
  source text not null,
  fact_type text not null,
  reliability numeric(5,4) not null check (reliability between 0 and 1),
  sample_size int not null default 0 check (sample_size >= 0),
  last_evaluated_at timestamptz not null default now(),
  unique (source, fact_type)
);

create table if not exists public.daily_briefs (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null references public.leagues(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  season int not null,
  week int not null,
  payload jsonb not null,
  computed_at timestamptz not null,
  fresh_until timestamptz not null,
  engine_version text not null,
  unique (league_id, user_id, season, week, computed_at)
);

create index if not exists idx_workspace_members_user on public.workspace_members(user_id, workspace_id);
create index if not exists idx_leagues_workspace on public.leagues(workspace_id);
create index if not exists idx_league_memberships_user on public.league_memberships(user_id, league_id);
create index if not exists idx_assignments_player on public.roster_assignments(player_id);
create index if not exists idx_predictions_target on public.prediction_events(target_season, target_week, prediction_type);
create index if not exists idx_decisions_user_time on public.decision_events(user_id, created_at desc);
create index if not exists idx_briefs_user_time on public.daily_briefs(user_id, computed_at desc);

create or replace function public.is_workspace_member(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id and wm.user_id = auth.uid()
  );
$$;

create or replace function public.can_manage_workspace(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role in ('owner', 'admin')
  );
$$;

create or replace function public.is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspace_members wm
    where wm.workspace_id = target_workspace_id
      and wm.user_id = auth.uid()
      and wm.role = 'owner'
  );
$$;

create or replace function public.can_access_league(target_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.leagues l
    join public.workspace_members wm on wm.workspace_id = l.workspace_id
    where l.id = target_league_id and wm.user_id = auth.uid()
  );
$$;

create or replace function public.is_workspace_creator(target_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.workspaces w
    where w.id = target_workspace_id and w.created_by = auth.uid()
  );
$$;

-- Creating a workspace must atomically grant the creator ownership. Without a
-- trigger, the creator could insert the workspace but be unable to read it or
-- insert the first membership under RLS.
create or replace function public.add_workspace_owner()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  insert into public.workspace_members (workspace_id, user_id, role)
  values (new.id, new.created_by, 'owner')
  on conflict (workspace_id, user_id) do update set role = 'owner';
  return new;
end;
$$;

drop trigger if exists workspace_owner_membership on public.workspaces;
create trigger workspace_owner_membership
after insert on public.workspaces
for each row execute function public.add_workspace_owner();

revoke all on function public.is_workspace_member(uuid) from public;
revoke all on function public.can_manage_workspace(uuid) from public;
revoke all on function public.is_workspace_owner(uuid) from public;
revoke all on function public.can_access_league(uuid) from public;
revoke all on function public.is_workspace_creator(uuid) from public;
revoke all on function public.add_workspace_owner() from public;
grant execute on function public.is_workspace_member(uuid) to authenticated, service_role;
grant execute on function public.can_manage_workspace(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_owner(uuid) to authenticated, service_role;
grant execute on function public.can_access_league(uuid) to authenticated, service_role;
grant execute on function public.is_workspace_creator(uuid) to authenticated, service_role;

alter table public.workspaces enable row level security;
alter table public.workspace_members enable row level security;
alter table public.league_scoring_rules enable row level security;
alter table public.league_memberships enable row level security;
alter table public.manager_preferences enable row level security;
alter table public.roster_slot_definitions enable row level security;
alter table public.roster_assignments enable row level security;
alter table public.prediction_events enable row level security;
alter table public.prediction_outcomes enable row level security;
alter table public.decision_events enable row level security;
alter table public.engine_calibration enable row level security;
alter table public.source_performance enable row level security;
alter table public.daily_briefs enable row level security;

drop policy if exists "leagues owner access" on public.leagues;
drop policy if exists "rosters via league owner" on public.rosters;
drop policy if exists "scores via league owner or global" on public.player_scores;
drop policy if exists "recommendations via league owner" on public.recommendations;
drop policy if exists "scout_runs public read" on public.scout_runs;

create policy "workspace members read workspace" on public.workspaces for select using (public.is_workspace_member(id));
create policy "users create workspace" on public.workspaces for insert with check (created_by = auth.uid());
create policy "admins update workspace" on public.workspaces for update using (public.can_manage_workspace(id)) with check (public.can_manage_workspace(id));
create policy "owners delete workspace" on public.workspaces for delete using (
  exists (select 1 from public.workspace_members wm where wm.workspace_id = id and wm.user_id = auth.uid() and wm.role = 'owner')
);

create policy "members read memberships" on public.workspace_members for select using (public.is_workspace_member(workspace_id));
create policy "managers add memberships" on public.workspace_members for insert with check (
  public.is_workspace_owner(workspace_id)
  or (public.can_manage_workspace(workspace_id) and role in ('member', 'viewer'))
);
create policy "owners update memberships" on public.workspace_members for update using (public.is_workspace_owner(workspace_id)) with check (public.is_workspace_owner(workspace_id));
create policy "owners delete memberships" on public.workspace_members for delete using (public.is_workspace_owner(workspace_id));

create policy "members read leagues" on public.leagues for select using (public.is_workspace_member(workspace_id));
create policy "admins create leagues" on public.leagues for insert with check (public.can_manage_workspace(workspace_id));
create policy "admins update leagues" on public.leagues for update using (public.can_manage_workspace(workspace_id)) with check (public.can_manage_workspace(workspace_id));
create policy "admins delete leagues" on public.leagues for delete using (public.can_manage_workspace(workspace_id));

create policy "members read rosters" on public.rosters for select using (public.can_access_league(league_id));
create policy "admins create rosters" on public.rosters for insert with check (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
);
create policy "admins update rosters" on public.rosters for update using (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
) with check (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
);
create policy "admins delete rosters" on public.rosters for delete using (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
);

create policy "members read league mappings" on public.league_memberships for select using (public.can_access_league(league_id));
create policy "admins manage league mappings" on public.league_memberships for all using (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
) with check (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
);

create policy "users read own preferences" on public.manager_preferences for select using (user_id = auth.uid() and public.can_access_league(league_id));
create policy "users insert own preferences" on public.manager_preferences for insert with check (user_id = auth.uid() and public.can_access_league(league_id));
create policy "users update own preferences" on public.manager_preferences for update using (user_id = auth.uid() and public.can_access_league(league_id)) with check (user_id = auth.uid() and public.can_access_league(league_id));

create policy "members read roster slots" on public.roster_slot_definitions for select using (public.can_access_league(league_id));
create policy "admins manage roster slots" on public.roster_slot_definitions for all using (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
) with check (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
);

create policy "members read scoring rules" on public.league_scoring_rules for select using (public.can_access_league(league_id));
create policy "admins manage scoring rules" on public.league_scoring_rules for all using (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
) with check (
  exists (select 1 from public.leagues l where l.id = league_id and public.can_manage_workspace(l.workspace_id))
);

create policy "members read assignments" on public.roster_assignments for select using (
  exists (select 1 from public.rosters r where r.id = roster_id and public.can_access_league(r.league_id))
);
create policy "admins manage assignments" on public.roster_assignments for all using (
  exists (select 1 from public.rosters r join public.leagues l on l.id = r.league_id where r.id = roster_id and public.can_manage_workspace(l.workspace_id))
) with check (
  exists (select 1 from public.rosters r join public.leagues l on l.id = r.league_id where r.id = roster_id and public.can_manage_workspace(l.workspace_id))
);

create policy "members read scores" on public.player_scores for select using (league_id is null or public.can_access_league(league_id));
create policy "members read personalized recommendations" on public.recommendations for select using (
  public.can_access_league(league_id) and (user_id is null or user_id = auth.uid())
);
create policy "members read scoped scout runs" on public.scout_runs for select using (workspace_id is not null and public.is_workspace_member(workspace_id));

create policy "users read own predictions" on public.prediction_events for select using (
  (user_id is null and (league_id is null or public.can_access_league(league_id))) or user_id = auth.uid()
);
create policy "users create own predictions" on public.prediction_events for insert with check (
  user_id = auth.uid() and (league_id is null or public.can_access_league(league_id))
);
create policy "users read own outcomes" on public.prediction_outcomes for select using (
  exists (select 1 from public.prediction_events pe where pe.id = prediction_id and ((pe.user_id is null and (pe.league_id is null or public.can_access_league(pe.league_id))) or pe.user_id = auth.uid()))
);
create policy "users record own outcomes" on public.prediction_outcomes for insert with check (
  exists (
    select 1 from public.prediction_events pe
    where pe.id = prediction_id
      and pe.user_id = auth.uid()
      and finalized_at >= pe.created_at
  )
);
create policy "users read own decisions" on public.decision_events for select using (user_id = auth.uid() and public.can_access_league(league_id));
create policy "users record own decisions" on public.decision_events for insert with check (user_id = auth.uid() and public.can_access_league(league_id));
create policy "users update own decisions" on public.decision_events for update using (user_id = auth.uid() and public.can_access_league(league_id)) with check (user_id = auth.uid() and public.can_access_league(league_id));
create policy "users delete own decisions" on public.decision_events for delete using (user_id = auth.uid() and public.can_access_league(league_id));
create policy "authenticated read calibration" on public.engine_calibration for select to authenticated using (true);
create policy "authenticated read source performance" on public.source_performance for select to authenticated using (true);
create policy "users read own briefs" on public.daily_briefs for select using (user_id = auth.uid() and public.can_access_league(league_id));
