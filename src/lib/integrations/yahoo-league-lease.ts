import type { SupabaseClient } from "@supabase/supabase-js";

export class YahooLeagueLeaseError extends Error {
  constructor(public readonly code: string, public readonly status: 409 | 503 = 503) {
    super(code);
    this.name = "YahooLeagueLeaseError";
  }
}

/** Atomic database leases protect shared state across independent managers. */
export async function withYahooLeagueLeases<T>(
  client: SupabaseClient, leagueKeys: string[], leaseId: string, work: () => Promise<T>,
): Promise<T> {
  const keys = [...new Set(leagueKeys)].sort();
  if (!keys.length || keys.length > 10 || keys.some((key) => !/^\d+\.l\.\d+$/.test(key))) {
    throw new YahooLeagueLeaseError("yahoo_league_keys_invalid");
  }
  const acquired: string[] = [];
  try {
    for (const key of keys) {
      const claim = await client.rpc("claim_yahoo_league_sync", { p_league_key: key, p_lease_id: leaseId });
      if (claim.error) throw new YahooLeagueLeaseError(claim.error.code === "PGRST202"
        ? "yahoo_league_lease_migration_required" : "yahoo_league_lease_unavailable");
      if (claim.data !== true) throw new YahooLeagueLeaseError("yahoo_league_sync_in_progress", 409);
      acquired.push(key);
    }
    return await work();
  } finally {
    let releaseFailed = false;
    for (const key of acquired.reverse()) {
      const release = await client.rpc("release_yahoo_league_sync", { p_league_key: key, p_lease_id: leaseId });
      if (release.error || release.data !== true) releaseFailed = true;
    }
    if (releaseFailed) throw new YahooLeagueLeaseError("yahoo_league_lease_release_failed");
  }
}
