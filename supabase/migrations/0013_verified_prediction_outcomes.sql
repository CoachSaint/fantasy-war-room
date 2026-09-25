-- Preserve the source and pregame proof needed to score a forecast later.
alter table public.prediction_events
  add column if not exists pre_outcome_verified boolean not null default false,
  add column if not exists pre_outcome_proof jsonb not null default '{}'::jsonb;
alter table public.prediction_outcomes
  add column if not exists source_snapshot_id uuid references public.player_snapshots(id) on delete restrict,
  add column if not exists source_observed_at timestamptz,
  add column if not exists scoring_engine_version text;
create index if not exists idx_predictions_pending_outcome
  on public.prediction_events(league_id, target_season, target_week, created_at)
  where pre_outcome_verified;

create or replace function public.record_yahoo_recommendation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_season int;
  target_week int;
  points jsonb;
  matchup_key text;
  matchup_observed_at timestamptz;
  subject_snapshot_id uuid;
  alternative_snapshot_id uuid;
  pregame_proof jsonb := '{}'::jsonb;
begin
  if new.engine_version not in ('war-v0.1-yahoo-lineup', 'war-v0.1-yahoo-waiver') then
    return new;
  end if;
  if new.user_id is null or coalesce(new.payload->>'targetSeason', '') !~ '^[0-9]{4}$'
    or coalesce(new.payload->>'targetWeek', '') !~ '^[0-9]{1,2}$' then
    raise exception 'yahoo_recommendation_ledger_context_missing' using errcode = '23514';
  end if;
  target_season := (new.payload->>'targetSeason')::int;
  target_week := (new.payload->>'targetWeek')::int;
  points := new.payload->'projectedPoints';
  if target_week < 0 or target_week > 23 or jsonb_typeof(points->'recommended') <> 'number'
    or jsonb_typeof(points->'current') <> 'number' then
    raise exception 'yahoo_recommendation_ledger_projection_missing' using errcode = '23514';
  end if;

  select m.provider_matchup_key, m.observed_at into matchup_key, matchup_observed_at
    from public.league_week_matchups m
    where m.league_id = new.league_id and m.week = target_week
      and new.roster_id in (m.team_a_roster_id, m.team_b_roster_id)
      and m.status = 'pre_event' and m.observed_at <= new.computed_at
      and m.observed_at > new.computed_at - interval '6 hours'
    order by m.observed_at desc limit 1;
  if matchup_key is not null then
    pregame_proof := jsonb_build_object('source', 'yahoo_scoreboard',
      'matchupKey', matchup_key, 'status', 'pre_event',
      'observedAt', matchup_observed_at);
  end if;
  select s.id into subject_snapshot_id from public.player_snapshots s
    where s.player_id = new.subject_player_id and s.season = target_season
      and s.week = target_week and s.source = 'sleeper_weekly_projections'
      and s.observed_at <= new.computed_at
    order by s.observed_at desc limit 1;
  if new.alternative_player_id is not null then
    select s.id into alternative_snapshot_id from public.player_snapshots s
      where s.player_id = new.alternative_player_id and s.season = target_season
        and s.week = target_week and s.source = 'sleeper_weekly_projections'
        and s.observed_at <= new.computed_at
      order by s.observed_at desc limit 1;
  end if;

  insert into public.decision_events (
    user_id, league_id, recommendation_id, alternatives, confidence,
    recommended_at, recommendation_snapshot
  ) values (
    new.user_id, new.league_id, new.id,
    jsonb_build_array(jsonb_build_object('playerId', new.alternative_player_id,
      'projectedPoints', points->'current')),
    new.confidence, new.computed_at,
    jsonb_build_object('kind', new.kind, 'rosterId', new.roster_id,
      'subjectPlayerId', new.subject_player_id, 'headline', new.headline,
      'reasonCodes', new.reason_codes, 'evidenceIds', new.evidence_ids,
      'engineVersion', new.engine_version, 'projectedPoints', points,
      'confidenceMeaning', new.payload->>'confidenceMeaning')
  );

  insert into public.prediction_events (
    player_id, league_id, user_id, prediction_type, target_season,
    target_week, predicted_mean, feature_snapshot_id, engine_version,
    evidence_cutoff_at, pre_outcome_verified, pre_outcome_proof
  ) values (
    new.subject_player_id, new.league_id, new.user_id, 'weekly_points',
    target_season, target_week, (points->>'recommended')::numeric,
    subject_snapshot_id, new.engine_version, least(new.computed_at, now()),
    matchup_key is not null and subject_snapshot_id is not null, pregame_proof
  );
  if new.alternative_player_id is not null then
    insert into public.prediction_events (
      player_id, league_id, user_id, prediction_type, target_season,
      target_week, predicted_mean, feature_snapshot_id, engine_version,
      evidence_cutoff_at, pre_outcome_verified, pre_outcome_proof
    ) values (
      new.alternative_player_id, new.league_id, new.user_id, 'weekly_points',
      target_season, target_week, (points->>'current')::numeric,
      alternative_snapshot_id, new.engine_version, least(new.computed_at, now()),
      matchup_key is not null and alternative_snapshot_id is not null, pregame_proof
    );
  end if;
  return new;
end;
$$;

-- Only trusted server code calls this aggregate after authenticating a league member.
create or replace function public.user_prediction_accuracy(p_league_id uuid, p_user_id uuid)
returns table(sample_size bigint, mae numeric, rmse numeric, last_finalized_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select count(*)::bigint,
    round(avg(abs(o.prediction_error)), 3),
    round(sqrt(avg(o.prediction_error * o.prediction_error)), 3),
    max(o.finalized_at)
  from public.prediction_events p
  join public.prediction_outcomes o on o.prediction_id = p.id
  where p.league_id = p_league_id and p.user_id = p_user_id
    and p.prediction_type = 'weekly_points' and p.pre_outcome_verified
    and p.predicted_mean is not null and o.actual_fantasy_points is not null
    and o.scoring_engine_version = 'yahoo-actual-v1';
$$;
revoke execute on function public.user_prediction_accuracy(uuid, uuid) from public, anon, authenticated;
grant execute on function public.user_prediction_accuracy(uuid, uuid) to service_role;

create or replace function public.pending_yahoo_predictions(
  p_league_id uuid, p_season int, p_current_week int
)
returns table(prediction_id uuid, player_id uuid, target_week int,
  predicted_mean numeric, created_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.player_id, p.target_week, p.predicted_mean, p.created_at
  from public.prediction_events p
  left join public.prediction_outcomes o on o.prediction_id = p.id
  where p.league_id = p_league_id and p.target_season = p_season
    and p.target_week < p_current_week and p.prediction_type = 'weekly_points'
    and p.pre_outcome_verified and p.feature_snapshot_id is not null
    and p.predicted_mean is not null and o.prediction_id is null
  order by p.created_at, p.id
  limit 501;
$$;
revoke execute on function public.pending_yahoo_predictions(uuid, int, int) from public, anon, authenticated;
grant execute on function public.pending_yahoo_predictions(uuid, int, int) to service_role;
