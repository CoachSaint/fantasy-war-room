-- Capture every source-backed Yahoo recommendation in the same transaction as
-- its publication. Refreshes expire recommendations without deleting history.
alter table public.decision_events
  add column if not exists recommendation_snapshot jsonb not null default '{}'::jsonb;

create index if not exists idx_decisions_league_user_time
  on public.decision_events(league_id, user_id, recommended_at desc);

create or replace function public.record_yahoo_recommendation()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  target_season int;
  target_week int;
  points jsonb;
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
    target_week, predicted_mean, engine_version, evidence_cutoff_at
  ) values (
    new.subject_player_id, new.league_id, new.user_id, 'weekly_points',
    target_season, target_week, (points->>'recommended')::numeric,
    new.engine_version, least(new.computed_at, now())
  );
  if new.alternative_player_id is not null then
    insert into public.prediction_events (
      player_id, league_id, user_id, prediction_type, target_season,
      target_week, predicted_mean, engine_version, evidence_cutoff_at
    ) values (
      new.alternative_player_id, new.league_id, new.user_id, 'weekly_points',
      target_season, target_week, (points->>'current')::numeric,
      new.engine_version, least(new.computed_at, now())
    );
  end if;
  return new;
end;
$$;

drop trigger if exists record_yahoo_recommendation on public.recommendations;
create trigger record_yahoo_recommendation
  after insert on public.recommendations
  for each row execute function public.record_yahoo_recommendation();

-- A published decision can expire, but its original claim cannot be rewritten.
create or replace function public.protect_yahoo_recommendation_history()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.engine_version in ('war-v0.1-yahoo-lineup', 'war-v0.1-yahoo-waiver')
    and to_jsonb(new) - 'fresh_until' <> to_jsonb(old) - 'fresh_until' then
    raise exception 'yahoo_recommendation_history_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;

drop trigger if exists protect_yahoo_recommendation_history on public.recommendations;
create trigger protect_yahoo_recommendation_history
  before update on public.recommendations
  for each row execute function public.protect_yahoo_recommendation_history();
