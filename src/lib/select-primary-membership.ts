export function selectPrimaryMembership<T>(memberships: T[]): T | undefined {
  return memberships.find((entry) => {
    if (!entry || typeof entry !== "object" || !("membership" in entry)) return false;
    const membership = entry.membership;
    return Boolean(membership && typeof membership === "object" && "isPrimary" in membership && membership.isPrimary === true);
  }) ?? memberships[0];
}
