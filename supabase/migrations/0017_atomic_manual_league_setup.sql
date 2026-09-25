-- A manual setup must either create its entire workspace/league/roster graph
-- or create none of it. PostgREST runs this function in one transaction.
create function public.create_manual_league_setup(
  p_user_id uuid,
  p_workspace_id uuid,
  p_create_workspace boolean,
  p_workspace_name text,
  p_league_id uuid,
  p_provider_league_id text,
  p_league_name text,
  p_season int,
  p_week int,
  p_scoring jsonb,
  p_roster_positions jsonb,
  p_scoring_rules jsonb,
  p_slots jsonb,
  p_rosters jsonb,
  p_selected_roster_id uuid,
  p_selected_manager_id text,
  p_assignments jsonb
)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  workspace_role text;
begin
  if p_user_id is null or p_workspace_id is null or p_league_id is null
    or p_selected_roster_id is null or coalesce(p_selected_manager_id, '') = ''
    or jsonb_typeof(p_scoring_rules) <> 'array'
    or jsonb_typeof(p_slots) <> 'array'
    or jsonb_typeof(p_rosters) <> 'array'
    or jsonb_typeof(p_assignments) <> 'array'
    or jsonb_array_length(p_rosters) < 2 or jsonb_array_length(p_rosters) > 32
    or jsonb_array_length(p_slots) < 1 or jsonb_array_length(p_slots) > 128
    or jsonb_array_length(p_assignments) > 10000 then
    raise exception 'invalid_setup_payload' using errcode = '22023';
  end if;

  if p_create_workspace then
    insert into public.workspaces (id, name, created_by)
    values (p_workspace_id, left(p_workspace_name, 120), p_user_id);
    insert into public.workspace_members (workspace_id, user_id, role)
    values (p_workspace_id, p_user_id, 'owner') on conflict do nothing;
  else
    select wm.role into workspace_role from public.workspace_members wm
      where wm.workspace_id = p_workspace_id and wm.user_id = p_user_id
      for share;
    if workspace_role is null or workspace_role not in ('owner', 'admin') then
      raise exception 'workspace_manage_required' using errcode = 'P0001';
    end if;
  end if;

  insert into public.leagues (
    id, owner_id, workspace_id, provider, provider_league_id, name,
    season, current_week, scoring, roster_positions
  ) values (
    p_league_id, p_user_id, p_workspace_id, 'manual', p_provider_league_id,
    p_league_name, p_season, p_week, p_scoring, p_roster_positions
  );

  insert into public.league_scoring_rules (league_id, category, stat_key, position, points)
    select p_league_id, rule.category, rule.stat_key, rule.position, rule.points
    from jsonb_to_recordset(p_scoring_rules) as rule(
      category text, stat_key text, position text, points numeric
    );

  insert into public.roster_slot_definitions (
    league_id, slot_type, slot_order, eligible_positions, required
  ) select p_league_id, slot.slot_type, slot.slot_order,
      slot.eligible_positions, slot.required
    from jsonb_to_recordset(p_slots) as slot(
      slot_type text, slot_order int, eligible_positions text[], required boolean
    );

  insert into public.rosters (
    id, league_id, provider_roster_id, name, owner_user_id, player_ids, starter_ids
  ) select roster.id, p_league_id, roster.provider_roster_id,
      roster.name, roster.owner_user_id, '{}'::uuid[], '{}'::uuid[]
    from jsonb_to_recordset(p_rosters) as roster(
      id uuid, provider_roster_id text, name text, owner_user_id uuid
    );

  if not exists (select 1 from public.rosters r
    where r.id = p_selected_roster_id and r.league_id = p_league_id
      and r.owner_user_id = p_user_id) then
    raise exception 'roster_mapping_failed' using errcode = 'P0001';
  end if;

  insert into public.league_memberships (
    league_id, user_id, roster_id, provider_user_id, is_primary
  ) values (p_league_id, p_user_id, p_selected_roster_id, p_selected_manager_id, true);
  insert into public.manager_preferences (user_id, league_id)
    values (p_user_id, p_league_id);

  insert into public.roster_assignments (
    roster_id, league_id, player_id, designation, slot_definition_id
  ) select assignment.roster_id, p_league_id, assignment.player_id, 'bench', null
    from jsonb_to_recordset(p_assignments) as assignment(
      roster_id uuid, player_id uuid
    );

  return jsonb_build_object('workspaceId', p_workspace_id,
    'leagueId', p_league_id, 'rosterId', p_selected_roster_id);
end;
$$;

revoke execute on function public.create_manual_league_setup(
  uuid, uuid, boolean, text, uuid, text, text, int, int,
  jsonb, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.create_manual_league_setup(
  uuid, uuid, boolean, text, uuid, text, text, int, int,
  jsonb, jsonb, jsonb, jsonb, jsonb, uuid, text, jsonb
) to service_role;
