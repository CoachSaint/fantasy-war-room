-- Ledger facts are written by trusted server materializers only. User actions
-- may later update response fields through a membership-checked server route.
drop policy if exists "users create own predictions" on public.prediction_events;
drop policy if exists "users record own outcomes" on public.prediction_outcomes;
drop policy if exists "users record own decisions" on public.decision_events;
drop policy if exists "users update own decisions" on public.decision_events;
drop policy if exists "users delete own decisions" on public.decision_events;

create or replace function public.protect_decision_event_facts()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if to_jsonb(new) - 'response' - 'user_note' - 'responded_at'
    <> to_jsonb(old) - 'response' - 'user_note' - 'responded_at' then
    raise exception 'decision_event_facts_immutable' using errcode = '23514';
  end if;
  return new;
end;
$$;
drop trigger if exists protect_decision_event_facts on public.decision_events;
create trigger protect_decision_event_facts
  before update on public.decision_events
  for each row execute function public.protect_decision_event_facts();

create or replace function public.protect_prediction_event_facts()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  raise exception 'prediction_event_facts_immutable' using errcode = '23514';
end;
$$;
drop trigger if exists protect_prediction_event_facts on public.prediction_events;
create trigger protect_prediction_event_facts
  before update on public.prediction_events
  for each row execute function public.protect_prediction_event_facts();
