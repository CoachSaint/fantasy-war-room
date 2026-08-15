import { describe, expect, it } from "vitest";
import { isSupabaseConfigured, createClient } from "../src/lib/supabase/browser";
import { hasAdminCredentials, createAdminClient } from "../src/lib/supabase/admin";
import { GET as healthGET } from "../src/app/api/health/route";
import { GET as recommendationsGET } from "../src/app/api/recommendations/route";
import { GET as scoutRunGET } from "../src/app/api/scout/run/route";

describe("Supabase Client Wrappers", () => {
  it("checks browser configuration safely", () => {
    expect(typeof isSupabaseConfigured()).toBe("boolean");
  });

  it("checks admin configuration safely", () => {
    expect(typeof hasAdminCredentials()).toBe("boolean");
  });

  it("throws clear error when browser client is unconfigured", () => {
    if (!isSupabaseConfigured()) {
      expect(() => createClient()).toThrow("Supabase browser environment is not configured");
    }
  });

  it("throws clear error when admin client is unconfigured", () => {
    if (!hasAdminCredentials()) {
      expect(() => createAdminClient()).toThrow("Supabase admin environment is not configured");
    }
  });
});

describe("API Routes", () => {
  it("health endpoint returns 200 with status info", async () => {
    const res = await healthGET();
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.service).toBe("fantasy-war-room");
    expect(json.status).toBe("ok");
  });

  it("recommendations endpoint returns recommendation list", async () => {
    const req = new Request("http://localhost:3000/api/recommendations?demo=true");
    const res = await recommendationsGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(Array.isArray(json.data)).toBe(true);
    expect(json.data.length).toBeGreaterThan(0);
    expect(json.demo).toBe(true);
  });

  it("recommendations endpoint filters by kind", async () => {
    const req = new Request("http://localhost:3000/api/recommendations?demo=true&kind=add");
    const res = await recommendationsGET(req);
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.data.every((r: { kind: string }) => r.kind === "add")).toBe(true);
  });

  it("recommendations endpoint handles malformed limits without a server error", async () => {
    const req = new Request("http://localhost:3000/api/recommendations?demo=true&limit=not-a-number");
    const res = await recommendationsGET(req);

    // A hardened route may reject malformed input (4xx); the current route
    // safely falls back to an empty demo result. Neither is a server failure.
    expect(res.status).toBeLessThan(500);
    const json = await res.json();
    expect(json).toBeTypeOf("object");
    if (res.status === 200) {
      expect(Array.isArray(json.data)).toBe(true);
      expect(json.count).toBe(0);
    }
  });

  it("scout run endpoint rejects alternate secret transports", async () => {
    const oldSecret = process.env.CRON_SECRET;
    const oldEnv = process.env.NODE_ENV;
    const env = process.env as Record<string, string | undefined>;

    try {
      process.env.CRON_SECRET = "test-secret-123";
      env.NODE_ENV = "production";

      // Only the exact Bearer header is an authorization transport. Query
      // parameters and x-cron-secret must never authorize a run, even with
      // the correct secret value.
      const unauthorizedRequests: Request[] = [
        new Request("http://localhost:3000/api/scout/run"),
        new Request("http://localhost:3000/api/scout/run?secret=test-secret-123"),
        new Request("http://localhost:3000/api/scout/run", {
          headers: { "x-cron-secret": "test-secret-123" },
        }),
        new Request("http://localhost:3000/api/scout/run", {
          headers: { Authorization: "Bearer wrong-secret" },
        }),
      ];
      for (const unauthReq of unauthorizedRequests) {
        const unauthRes = await scoutRunGET(unauthReq);
        expect(unauthRes.status).toBe(401);
      }
    } finally {
      if (oldSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = oldSecret;
      if (oldEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = oldEnv;
    }
  });

  it("scout run endpoint degrades safely when Supabase is unavailable", async () => {
    const oldSecret = process.env.CRON_SECRET;
    const oldEnv = process.env.NODE_ENV;
    const env = process.env as Record<string, string | undefined>;

    try {
      process.env.CRON_SECRET = "test-secret-123";
      env.NODE_ENV = "production";

      const authReq = new Request("http://localhost:3000/api/scout/run", {
        headers: { Authorization: "Bearer test-secret-123" },
      });
      const authRes = await scoutRunGET(authReq);
      const json = await authRes.json();

      if (!hasAdminCredentials()) {
        expect(authRes.status).toBe(503);
        expect(json.ok).toBe(false);
        expect(json.status).toBe("degraded");
      } else {
        // A successful run is only possible with actual admin credentials;
        // persistence/provider failures may still return a safe 503.
        if (authRes.status === 200) {
          expect(hasAdminCredentials()).toBe(true);
        } else {
          expect(authRes.status).toBe(503);
          expect(json.ok).toBe(false);
        }
      }
    } finally {
      if (oldSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = oldSecret;
      if (oldEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = oldEnv;
    }
  });

  it("scout run endpoint rejects invalid season and week before work", async () => {
    const oldSecret = process.env.CRON_SECRET;
    const oldEnv = process.env.NODE_ENV;
    const env = process.env as Record<string, string | undefined>;

    try {
      process.env.CRON_SECRET = "test-secret-123";
      env.NODE_ENV = "production";

      for (const query of ["season=2019", "season=2026&week=24", "season=not-a-season"]) {
        const request = new Request(`http://localhost:3000/api/scout/run?${query}`, {
          headers: { Authorization: "Bearer test-secret-123" },
        });
        const response = await scoutRunGET(request);
        expect(response.status).toBe(400);
        const json = await response.json();
        expect(json.ok).toBe(false);
        expect(json.error).toBe("invalid_scout_input");
      }
    } finally {
      if (oldSecret === undefined) delete process.env.CRON_SECRET;
      else process.env.CRON_SECRET = oldSecret;
      if (oldEnv === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = oldEnv;
    }
  });
});
