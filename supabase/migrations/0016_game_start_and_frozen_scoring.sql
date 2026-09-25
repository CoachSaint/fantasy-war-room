-- A Yahoo matchup's pre_event status does not prove that an individual NFL
-- game has not kicked off. Use the published game schedule and freeze rules.
create table public.nfl_game_starts (
  season int not null,
  week int not null check (week between 1 and 23),
  team text not null check (team ~ '^[A-Z]{2,3}$'),
  kickoff_at timestamptz not null,
  observed_at timestamptz not null,
  source text not null check (source = 'nflverse_schedules'),
  primary key (season, week, team)
);
alter table public.nfl_game_starts enable row level security;

create table public.yahoo_outcome_cursors (
  league_id uuid primary key references public.leagues(id) on delete cascade,
  after_created_at timestamptz,
  after_id uuid,
  check ((after_created_at is null) = (after_id is null))
);
alter table public.yahoo_outcome_cursors enable row level security;

alter table public.prediction_events
  add column scoring_snapshot jsonb not null default '{}'::jsonb;

-- The prior trigger could certify a forecast after kickoff while actual-stat
-- ingestion lagged. Existing certified rows have no game-start proof, so
-- retire that certification before enforcing the stronger rule.
alter table public.prediction_events disable trigger protect_prediction_event_facts;
update public.prediction_events set pre_outcome_verified = false,
  pre_outcome_proof = '{}'::jsonb where pre_outcome_verified;
alter table public.prediction_events enable trigger protect_prediction_event_facts;

create or replace function public.guard_yahoo_pregame_prediction()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  league_week int;
  league_scoring jsonb;
  proof_observed_at timestamptz;
  game_kickoff_at timestamptz;
  game_observed_at timestamptz;
  verified boolean;
begin
  select l.current_week, l.scoring into league_week, league_scoring
    from public.leagues l where l.id = new.league_id and l.provider = 'yahoo'
      and l.season = new.target_season;
  new.scoring_snapshot := coalesce(league_scoring, '{}'::jsonb);
  if not new.pre_outcome_verified then return new; end if;
  select g.kickoff_at, g.observed_at into game_kickoff_at, game_observed_at
    from public.players p join public.nfl_game_starts g on g.team = p.team
      and g.season = new.target_season and g.week = new.target_week
    where p.id = new.player_id and g.source = 'nflverse_schedules';
  proof_observed_at := nullif(new.pre_outcome_proof->>'observedAt', '')::timestamptz;
  verified := league_week = new.target_week
    and new.feature_snapshot_id is not null
    and jsonb_typeof(new.scoring_snapshot->'statModifiers') = 'object'
    and new.pre_outcome_proof->>'source' = 'yahoo_scoreboard'
    and new.pre_outcome_proof->>'status' = 'pre_event'
    and proof_observed_at is not null
    and proof_observed_at <= clock_timestamp()
    and proof_observed_at > clock_timestamp() - interval '30 minutes'
    and game_kickoff_at is not null
    and game_observed_at is not null
    and game_observed_at <= clock_timestamp()
    and game_observed_at > clock_timestamp() - interval '24 hours'
    and clock_timestamp() < game_kickoff_at
    and new.created_at < game_kickoff_at
    and proof_observed_at < game_kickoff_at
    and not exists (
      select 1 from public.player_snapshots s
      where s.player_id = new.player_id and s.season = new.target_season
        and s.week = new.target_week and s.source = 'nflverse_stats_player'
        and jsonb_typeof(s.data->'actualFantasyPoints') = 'number'
        and s.observed_at <= clock_timestamp()
    );
  if coalesce(verified, false) then
    new.pre_outcome_proof := new.pre_outcome_proof || jsonb_build_object(
      'gameKickoffAt', game_kickoff_at, 'gameScheduleObservedAt', game_observed_at,
      'gameScheduleSource', 'nflverse_schedules');
  else
    new.pre_outcome_verified := false;
    new.pre_outcome_proof := '{}'::jsonb;
  end if;
  return new;
end;
$$;

-- Keyset paging lets one run process a bounded slice and then advance past
-- sources that have no actual stats yet. The next run can revisit those rows.
drop function public.pending_yahoo_predictions(uuid, int, int);
create function public.pending_yahoo_predictions(
  p_league_id uuid, p_season int, p_current_week int,
  p_after_created_at timestamptz default null, p_after_id uuid default null
)
returns table(prediction_id uuid, player_id uuid, target_week int,
  predicted_mean numeric, created_at timestamptz, scoring_snapshot jsonb,
  game_kickoff_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.player_id, p.target_week, p.predicted_mean, p.created_at,
    p.scoring_snapshot,
    least((p.pre_outcome_proof->>'gameKickoffAt')::timestamptz, g.kickoff_at)
  from public.prediction_events p
  left join public.prediction_outcomes o on o.prediction_id = p.id
  join public.players player on player.id = p.player_id
  join public.nfl_game_starts g on g.team = player.team and g.season = p.target_season
    and g.week = p.target_week and g.source = 'nflverse_schedules'
  where p.league_id = p_league_id and p.target_season = p_season
    and p.target_week < p_current_week and p.prediction_type = 'weekly_points'
    and p.pre_outcome_verified and p.feature_snapshot_id is not null
    and p.predicted_mean is not null and o.prediction_id is null
    and (p_after_created_at is null or (p.created_at, p.id) > (p_after_created_at, p_after_id))
  order by p.created_at, p.id
  limit 100;
$$;
revoke execute on function public.pending_yahoo_predictions(uuid, int, int, timestamptz, uuid)
  from public, anon, authenticated;
grant execute on function public.pending_yahoo_predictions(uuid, int, int, timestamptz, uuid)
  to service_role;
