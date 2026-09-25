function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : null;
}

/** Resolve only the server-validated active league and the user's mapped roster. */
export function activeConnectedMembership(payload: unknown): Record<string, unknown> | null {
  const body = record(payload);
  if (!body || body.ok !== true || body.status !== "ready" || body.setupRequired === true) return null;
  const data = record(body.data);
  const activeLeagueId = data?.activeLeagueId;
  if (typeof activeLeagueId !== "string" || !activeLeagueId) return null;
  const selectable = Array.isArray(data?.selectableLeagueIds) ? data.selectableLeagueIds : [];
  if (!selectable.includes(activeLeagueId)) return null;
  const memberships = Array.isArray(data?.memberships) ? data.memberships : [];
  for (const value of memberships) {
    const entry = record(value);
    const league = entry && record(entry.league);
    const roster = entry && record(entry.roster);
    const membership = entry && record(entry.membership);
    if (league?.id === activeLeagueId && membership?.leagueId === activeLeagueId
      && typeof roster?.id === "string" && roster.id) return entry;
  }
  return null;
}
