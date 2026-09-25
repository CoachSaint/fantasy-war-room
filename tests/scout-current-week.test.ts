import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "../src/app/api/scout/run/route";

const nflState = vi.hoisted(() => ({ getNflState: vi.fn() }));

vi.mock("@/lib/data/sleeper", () => ({ sleeper: nflState }));
vi.mock("@/lib/supabase/admin", () => ({ hasAdminCredentials: () => false }));

afterEach(() => {
  delete process.env.CRON_SECRET;
  nflState.getNflState.mockReset();
});

describe("Scout period selection", () => {
  it("uses the provider's current NFL week when cron supplies no period", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    nflState.getNflState.mockResolvedValue({ season: "2026", week: 3 });
    const response = await GET(new Request("https://example.test/api/scout/run", { headers: { authorization: "Bearer test-cron-secret" } }));
    const body = await response.json();
    expect(response.status).toBe(503); // No database in this hermetic route test.
    expect(body).toMatchObject({ error: "supabase_unavailable", season: 2026, week: 3 });
    expect(nflState.getNflState).toHaveBeenCalledOnce();
  });

  it("refuses a partial override instead of combining different seasons and weeks", async () => {
    process.env.CRON_SECRET = "test-cron-secret";
    const response = await GET(new Request("https://example.test/api/scout/run?week=4", { headers: { authorization: "Bearer test-cron-secret" } }));
    expect(response.status).toBe(400);
    expect(nflState.getNflState).not.toHaveBeenCalled();
  });
});
