-- Do not promote a stale provider snapshot to pre-outcome proof. The ledger
-- still retains the forecast; only verified rows can enter measured accuracy.
create or replace function public.guard_yahoo_pregame_prediction()
returns trigger language plpgsql set search_path = public, pg_temp as $$
declare
  league_week int;
  proof_observed_at timestamptz;
  verified boolean;
begin
  if not new.pre_outcome_verified then return new; end if;
  select l.current_week into league_week from public.leagues l
    where l.id = new.league_id and l.provider = 'yahoo' and l.season = new.target_season;
  proof_observed_at := nullif(new.pre_outcome_proof->>'observedAt', '')::timestamptz;
  verified := league_week = new.target_week
    and new.feature_snapshot_id is not null
    and new.pre_outcome_proof->>'source' = 'yahoo_scoreboard'
    and new.pre_outcome_proof->>'status' = 'pre_event'
    and proof_observed_at is not null
    and proof_observed_at <= clock_timestamp()
    and proof_observed_at > clock_timestamp() - interval '30 minutes'
    and not exists (
      select 1 from public.player_snapshots s
      where s.player_id = new.player_id and s.season = new.target_season
        and s.week = new.target_week and s.source = 'nflverse_stats_player'
        and jsonb_typeof(s.data->'actualFantasyPoints') = 'number'
        and s.observed_at <= clock_timestamp()
    );
  if not coalesce(verified, false) then
    new.pre_outcome_verified := false;
    new.pre_outcome_proof := '{}'::jsonb;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_yahoo_pregame_prediction on public.prediction_events;
create trigger guard_yahoo_pregame_prediction
  before insert on public.prediction_events
  for each row execute function public.guard_yahoo_pregame_prediction();
