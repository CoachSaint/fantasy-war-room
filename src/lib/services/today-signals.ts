import type { SupabaseClient } from "@supabase/supabase-js";

const rosterAgeMs = 6 * 60 * 60_000;
const injuryAgeMs = 48 * 60 * 60_000;

export class TodaySignalsError extends Error {
  constructor(public readonly code: string, public readonly status = 503) {
    super(code);
    this.name = "TodaySignalsError";
  }
}

type InjuryRow = { id: string; player_id: string; summary: string; source_url: string | null;
  observed_at: string; fingerprint: string };
type GameRow = { player_id: string; week: number; data: unknown; observed_at: string };

function injuryStatus(summary: string): string | null {
  const match = /Injury Status:\s*([^.]{1,60})\./i.exec(summary);
  return match?.[1]?.trim() || null;
}

function validObserved(value: unknown, now: number, maxAgeMs: number): boolean {
  const time = Date.parse(String(value));
  return Number.isFinite(time) && time <= now + 5 * 60_000 && now - time <= maxAgeMs;
}

/** Own-roster source signals, separate from recommendation change history. */
export async function getTodaySignals(client: SupabaseClient, leagueId: string, userId: string, asOf = new Date()) {
  const now = asOf.getTime();
  const [league, membership] = await Promise.all([
    client.from("leagues").select("provider, season, current_week").eq("id", leagueId).maybeSingle(),
    client.from("league_memberships").select("roster_id")
      .eq("league_id", leagueId).eq("user_id", userId).maybeSingle(),
  ]);
  if (league.error || membership.error) throw new TodaySignalsError("today_source_unavailable");
  if (!league.data || !membership.data?.roster_id) throw new TodaySignalsError("owned_roster_unavailable", 409);
  const rosterId = String(membership.data.roster_id);
  const [roster, assignments] = await Promise.all([
    client.from("rosters").select("id, updated_at").eq("league_id", leagueId).eq("id", rosterId).maybeSingle(),
    client.from("roster_assignments").select("player_id, designation, provider_status")
      .eq("league_id", leagueId).eq("roster_id", rosterId).limit(101),
  ]);
  if (roster.error || assignments.error) throw new TodaySignalsError("today_roster_unavailable");
  if (!roster.data || (assignments.data || []).length > 100) throw new TodaySignalsError("today_roster_unavailable", 409);
  if (league.data.provider === "yahoo" && !validObserved(roster.data.updated_at, now, rosterAgeMs)) {
    throw new TodaySignalsError("yahoo_roster_sync_stale", 409);
  }
  const ids = [...new Set((assignments.data || []).map((row) => String(row.player_id)))];
  if (!ids.length) return { ok: true as const, status: "ready" as const, rosterObservedAt: String(roster.data.updated_at),
    injuries: [], risers: [], fallers: [], gameSource: "nflverse_stats_player" };
  const season = Number(league.data.season);
  const week = Number(league.data.current_week);
  const players = [];
  const injuries: InjuryRow[] = [];
  const games: GameRow[] = [];
  for (let offset = 0; offset < ids.length; offset += 100) {
    const batch = ids.slice(offset, offset + 100);
    const [playerRows, injuryRows, gameRows] = await Promise.all([
      client.from("players").select("id, full_name, position").in("id", batch),
      client.from("evidence").select("id, player_id, summary, source_url, observed_at, fingerprint")
        .eq("source", "nflverse_injuries").eq("type", "injury")
        .in("player_id", batch).order("observed_at", { ascending: false }).limit(501),
      client.from("player_snapshots").select("player_id, week, data, observed_at")
        .eq("source", "nflverse_stats_player").eq("season", season)
        .in("player_id", batch).order("week", { ascending: false })
        .order("observed_at", { ascending: false }).limit(1001),
    ]);
    if (playerRows.error || injuryRows.error || gameRows.error
      || (injuryRows.data || []).length > 500 || (gameRows.data || []).length > 1000) {
      throw new TodaySignalsError("today_source_unavailable");
    }
    players.push(...(playerRows.data || []));
    injuries.push(...(injuryRows.data || []));
    games.push(...(gameRows.data || []));
  }
  const byId = new Map(players.map((row) => [String(row.id), row]));
  const injuriesById = new Map<string, InjuryRow[]>();
  for (const row of injuries) {
    const id = String(row.player_id);
    const list = injuriesById.get(id) || [];
    if (!list.some((entry) => entry.fingerprint === row.fingerprint)) list.push(row);
    injuriesById.set(id, list);
  }
  const currentInjuries = [...injuriesById].flatMap(([id, reports]) => {
    const current = reports[0];
    const player = byId.get(id);
    if (!player || !current || !validObserved(current.observed_at, now, injuryAgeMs)) return [];
    // The fingerprint contains the source season and week. Historical injury
    // reports are not a current status when the league has advanced.
    if (!current.fingerprint.includes(`_s${season}_w${week}_`)) return [];
    const status = injuryStatus(current.summary);
    if (!status || /^(healthy|active|unspecified)$/i.test(status)) return [];
    const previous = reports.slice(1).find((entry) => entry.fingerprint.includes(`_s${season}_w${week}_`)
      && injuryStatus(entry.summary) !== status);
    return [{ playerId: id, playerName: String(player.full_name), position: String(player.position),
      status, previousStatus: previous ? injuryStatus(previous.summary) : null,
      summary: String(current.summary), observedAt: String(current.observed_at),
      sourceUrl: current.source_url ? String(current.source_url) : null,
      evidenceId: String(current.id), changed: Boolean(previous) }];
  }).sort((a, b) => Date.parse(b.observedAt) - Date.parse(a.observedAt)).slice(0, 6);
  const gamesById = new Map<string, GameRow[]>();
  for (const row of games) {
    const id = String(row.player_id);
    const list = gamesById.get(id) || [];
    if (!list.some((entry) => Number(entry.week) === Number(row.week))) list.push(row);
    gamesById.set(id, list);
  }
  const movement = [...gamesById].flatMap(([id, rows]) => {
    const player = byId.get(id);
    if (!player || rows.length < 2) return [];
    const [latest, prior] = rows;
    if (week - Number(latest.week) > 2 || week - Number(latest.week) < 0
      || Number(latest.week) - Number(prior.week) > 2) return [];
    const latestData = latest.data && typeof latest.data === "object" && !Array.isArray(latest.data)
      ? latest.data as Record<string, unknown> : {};
    const priorData = prior.data && typeof prior.data === "object" && !Array.isArray(prior.data)
      ? prior.data as Record<string, unknown> : {};
    const latestPoints = latestData.actualFantasyPoints;
    const priorPoints = priorData.actualFantasyPoints;
    if (typeof latestPoints !== "number" || !Number.isFinite(latestPoints)
      || typeof priorPoints !== "number" || !Number.isFinite(priorPoints)) return [];
    const change = Number((latestPoints - priorPoints).toFixed(1));
    if (Math.abs(change) < 3) return [];
    return [{ playerId: id, playerName: String(player.full_name), position: String(player.position),
      latestWeek: Number(latest.week), priorWeek: Number(prior.week),
      latestPoints, priorPoints, change,
      observedAt: String(latest.observed_at) }];
  });
  return { ok: true as const, status: "ready" as const, rosterObservedAt: String(roster.data.updated_at),
    injuries: currentInjuries,
    risers: movement.filter((row) => row.change > 0).sort((a, b) => b.change - a.change).slice(0, 3),
    fallers: movement.filter((row) => row.change < 0).sort((a, b) => a.change - b.change).slice(0, 3),
    gameSource: "nflverse_stats_player" as const };
}
