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
    expect(json.data.every((r: any) => r.kind === "add")).toBe(true);
  });

  it("scout run endpoint verifies authorization", async () => {
    const oldSecret = process.env.CRON_SECRET;
    const oldEnv = process.env.NODE_ENV;

    process.env.CRON_SECRET = "test-secret-123";
    (process.env as any).NODE_ENV = "production";

    // Request without header
    const unauthReq = new Request("http://localhost:3000/api/scout/run");
    const unauthRes = await scoutRunGET(unauthReq);
    expect(unauthRes.status).toBe(401);

    // Request with valid Bearer header
    const authReq = new Request("http://localhost:3000/api/scout/run", {
      headers: { Authorization: "Bearer test-secret-123" },
    });
    const authRes = await scoutRunGET(authReq);
    expect(authRes.status).toBe(200);
    const json = await authRes.json();
    expect(json.ok).toBe(true);
    expect(Array.isArray(json.steps)).toBe(true);

    process.env.CRON_SECRET = oldSecret;
    (process.env as any).NODE_ENV = oldEnv;
  });
});
