export function selectPrimaryMembership<T>(memberships: T[], preferredLeagueId?: string | null): T | undefined {
  if (preferredLeagueId) {
    const preferred = memberships.find((entry) => {
      if (!entry || typeof entry !== "object" || !("league" in entry)) return false;
      const league = entry.league;
      return Boolean(league && typeof league === "object" && "id" in league && league.id === preferredLeagueId);
    });
    if (preferred) return preferred;
  }
  return memberships.find((entry) => {
    if (!entry || typeof entry !== "object" || !("membership" in entry)) return false;
    const membership = entry.membership;
    return Boolean(membership && typeof membership === "object" && "isPrimary" in membership && membership.isPrimary === true);
  }) ?? memberships[0];
}
