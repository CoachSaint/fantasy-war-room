-- Distinct Yahoo managers share league, roster, and available-player rows.
-- Serialize their complete import + availability publication by league key.
create table if not exists public.yahoo_league_sync_leases (
  provider_league_id text primary key check (provider_league_id ~ '^[0-9]+[.]l[.][0-9]+$'),
  lease_id uuid not null,
  lock_until timestamptz not null,
  acquired_at timestamptz not null default now()
);
alter table public.yahoo_league_sync_leases enable row level security;

create or replace function public.claim_yahoo_league_sync(p_league_key text, p_lease_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare claimed uuid;
begin
  if p_league_key !~ '^[0-9]+[.]l[.][0-9]+$' or p_lease_id is null then
    raise exception 'invalid_yahoo_league_lease' using errcode = '22023';
  end if;
  insert into public.yahoo_league_sync_leases (provider_league_id, lease_id, lock_until)
    values (p_league_key, p_lease_id, now() + interval '35 minutes')
  on conflict (provider_league_id) do update
    set lease_id = excluded.lease_id,
        lock_until = excluded.lock_until,
        acquired_at = now()
    where yahoo_league_sync_leases.lock_until < now()
  returning lease_id into claimed;
  return coalesce(claimed = p_lease_id, false);
end;
$$;

create or replace function public.release_yahoo_league_sync(p_league_key text, p_lease_id uuid)
returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare released uuid;
begin
  delete from public.yahoo_league_sync_leases
    where provider_league_id = p_league_key and lease_id = p_lease_id
    returning lease_id into released;
  return coalesce(released = p_lease_id, false);
end;
$$;

revoke all on public.yahoo_league_sync_leases from anon, authenticated;
revoke execute on function public.claim_yahoo_league_sync(text, uuid) from public, anon, authenticated;
revoke execute on function public.release_yahoo_league_sync(text, uuid) from public, anon, authenticated;
grant execute on function public.claim_yahoo_league_sync(text, uuid) to service_role;
grant execute on function public.release_yahoo_league_sync(text, uuid) to service_role;

-- A stale import can never erase or reassign a team's confirmed owner.
create or replace function public.preserve_yahoo_roster_owner()
returns trigger language plpgsql set search_path = public, pg_temp as $$
begin
  if old.owner_user_id is not null
    and exists (select 1 from public.leagues where id = old.league_id and provider = 'yahoo') then
    if new.owner_user_id is null then
      new.owner_user_id := old.owner_user_id;
    elsif new.owner_user_id <> old.owner_user_id then
      raise exception 'yahoo_roster_already_claimed' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists preserve_yahoo_roster_owner on public.rosters;
create trigger preserve_yahoo_roster_owner
  before update of owner_user_id on public.rosters
  for each row execute function public.preserve_yahoo_roster_owner();
