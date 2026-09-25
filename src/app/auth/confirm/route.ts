import { createServerClient } from "@supabase/ssr";
import type { EmailOtpType } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const allowedTypes = new Set<EmailOtpType>(["invite", "magiclink"]);

function authRedirect(request: NextRequest): NextResponse {
  const configuredOrigin = process.env.NEXT_PUBLIC_APP_URL;
  const origin = configuredOrigin ? new URL(configuredOrigin).origin : request.nextUrl.origin;
  const response = NextResponse.redirect(new URL("/auth", origin));
  response.headers.set("Cache-Control", "no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}

/** Accept an emailed token hash on the server so the session reaches SSR APIs. */
export async function GET(request: NextRequest) {
  const tokenHash = request.nextUrl.searchParams.get("token_hash");
  const rawType = request.nextUrl.searchParams.get("type");
  if (!tokenHash || tokenHash.length < 20 || tokenHash.length > 256 || !/^[\w-]+$/.test(tokenHash) || !rawType || !allowedTypes.has(rawType as EmailOtpType)) {
    return authRedirect(request);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return authRedirect(request);

  const response = authRedirect(request);
  const client = createServerClient(url, key, {
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (values) => values.forEach(({ name, value, options }) => response.cookies.set(name, value, options)),
    },
  });

  try {
    const { error } = await client.auth.verifyOtp({ token_hash: tokenHash, type: rawType as EmailOtpType });
    return error ? authRedirect(request) : response;
  } catch {
    return authRedirect(request);
  }
}
