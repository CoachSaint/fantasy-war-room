import { createServerClient } from "@supabase/ssr";
import { createClient, SupabaseClient, User } from "@supabase/supabase-js";
import { cookies } from "next/headers";

export function hasAdminCredentials(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL &&
      process.env.SUPABASE_SERVICE_ROLE_KEY
  );
}

export function createAdminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    throw new Error(
      "Supabase admin environment is not configured. Set NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY."
    );
  }

  return createClient(url, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export type RequestAuth = {
  user: User;
  adminClient: SupabaseClient;
};

function bearerToken(request: Request): string | null {
  const value = request.headers.get("authorization")?.trim();
  if (!value) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(value);
  return match?.[1] || null;
}

/**
 * Resolve the authenticated Supabase user without trusting client supplied IDs.
 * Bearer tokens are preferred for API clients; the SSR cookie session is also
 * supported for browser requests.
 */
export async function getAuthenticatedRequest(request: Request): Promise<RequestAuth | null> {
  if (!hasAdminCredentials()) return null;

  const adminClient = createAdminClient();
  const token = bearerToken(request);
  if (token) {
    const { data, error } = await adminClient.auth.getUser(token);
    if (error || !data.user) return null;
    return { user: data.user, adminClient };
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;

  try {
    const cookieStore = await cookies();
    const serverClient = createServerClient(url, anonKey, {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (values) => {
          // Route handlers generally only read the session. When Supabase
          // refreshes it, persist the refreshed cookies when Next permits it.
          try {
            values.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
          } catch {
            // Read-only render contexts do not allow cookie mutation.
          }
        },
      },
    });
    const { data, error } = await serverClient.auth.getUser();
    if (error || !data.user) return null;
    return { user: data.user, adminClient };
  } catch {
    return null;
  }
}

/**
 * Verify membership before any service-role league read. The owner fallback is
 * retained only for installations that have not yet applied the membership
 * migration; it is still bound to the authenticated Supabase user.
 */
export async function authorizeLeagueAccess(
  request: Request,
  leagueId: string
): Promise<
  | { ok: true; auth: RequestAuth }
  | { ok: false; status: 401 | 403 | 503; error: string }
> {
  if (!hasAdminCredentials()) {
    return { ok: false, status: 503, error: "supabase_unavailable" };
  }

  let auth: RequestAuth | null;
  try {
    auth = await getAuthenticatedRequest(request);
  } catch {
    return { ok: false, status: 503, error: "authentication_unavailable" };
  }
  if (!auth) return { ok: false, status: 401, error: "authentication_required" };

  const membership = await auth.adminClient
    .from("league_memberships")
    .select("league_id, roster_id")
    .eq("league_id", leagueId)
    .eq("user_id", auth.user.id)
    .maybeSingle();

  if (!membership.error && membership.data) {
    return { ok: true, auth };
  }

  // The relation exists and returned a clean no-row result: this user is not a
  // member. Never fall through to legacy owner data after a membership was
  // explicitly removed.
  if (!membership.error) {
    return { ok: false, status: 403, error: "league_access_denied" };
  }

  // A missing relation means the v2 migration is not installed. Do not turn
  // any other database error into an authorization success.
  if (membership.error && membership.error.code !== "42P01") {
    return { ok: false, status: 503, error: "membership_check_unavailable" };
  }

  const legacyOwner = await auth.adminClient
    .from("leagues")
    .select("id")
    .eq("id", leagueId)
    .eq("owner_id", auth.user.id)
    .maybeSingle();

  if (!legacyOwner.error && legacyOwner.data) {
    return { ok: true, auth };
  }
  if (legacyOwner.error) {
    return { ok: false, status: 503, error: "membership_check_unavailable" };
  }

  return { ok: false, status: 403, error: "league_access_denied" };
}
