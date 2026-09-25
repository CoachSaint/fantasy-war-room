-- Repeated refreshes may publish the same forecast event. Count an identical
-- player/week/engine/source/value only once in reported error metrics.
create or replace function public.user_prediction_accuracy(p_league_id uuid, p_user_id uuid)
returns table(sample_size bigint, mae numeric, rmse numeric, last_finalized_at timestamptz)
language sql stable security definer set search_path = public, pg_temp as $$
  with unique_forecasts as (
    select distinct on (p.player_id, p.target_season, p.target_week,
      p.engine_version, p.feature_snapshot_id, p.predicted_mean)
      o.prediction_error, o.finalized_at
    from public.prediction_events p
    join public.prediction_outcomes o on o.prediction_id = p.id
    where p.league_id = p_league_id and p.user_id = p_user_id
      and p.prediction_type = 'weekly_points' and p.pre_outcome_verified
      and p.predicted_mean is not null and o.actual_fantasy_points is not null
      and o.scoring_engine_version = 'yahoo-actual-v1'
    order by p.player_id, p.target_season, p.target_week,
      p.engine_version, p.feature_snapshot_id, p.predicted_mean, p.created_at, p.id
  )
  select count(*)::bigint,
    round(avg(abs(prediction_error)), 3),
    round(sqrt(avg(prediction_error * prediction_error)), 3),
    max(finalized_at)
  from unique_forecasts;
$$;
