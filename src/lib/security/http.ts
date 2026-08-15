import { NextResponse } from "next/server";

type RateLimitOptions = { limit: number; windowMs: number };
type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

export function errorResponse(
  error: string,
  status: number,
  extra: Record<string, unknown> = {}
): NextResponse {
  return NextResponse.json({ ok: false, status: status >= 500 ? "unavailable" : "error", error, ...extra }, { status });
}

export function clientKey(request: Request, subject?: string): string {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return `${subject || "anonymous"}:${forwarded || "unknown"}`;
}

export function consumeRateLimit(key: string, options: RateLimitOptions): { allowed: boolean; retryAfterSeconds: number } {
  const now = Date.now();
  const existing = buckets.get(key);
  if (!existing || existing.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, retryAfterSeconds: 0 };
  }

  if (existing.count >= options.limit) {
    return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((existing.resetAt - now) / 1000)) };
  }

  existing.count += 1;
  return { allowed: true, retryAfterSeconds: 0 };
}

export function rateLimitResponse(retryAfterSeconds: number): NextResponse {
  const response = errorResponse("rate_limit_exceeded", 429, { retryAfterSeconds });
  response.headers.set("Retry-After", String(retryAfterSeconds));
  return response;
}
