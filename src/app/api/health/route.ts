import { NextResponse } from "next/server";
import { isSupabaseConfigured } from "@/lib/supabase/browser";
import { hasAdminCredentials, createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const supabaseConfigured = isSupabaseConfigured();
    const adminConfigured = hasAdminCredentials();
    let dbConnected = false;
    let lastScoutRun: { lastRunAt: string | null; lastRunStatus: string | null } = {
      lastRunAt: null,
      lastRunStatus: null,
    };

    if (adminConfigured) {
      try {
        const client = createAdminClient();
        const { data, error } = await client
          .from("scout_runs")
          .select("finished_at, status")
          .order("started_at", { ascending: false })
          .limit(1)
          .maybeSingle();

        if (!error) {
          dbConnected = true;
          if (data) {
            lastScoutRun = {
              lastRunAt: data.finished_at,
              lastRunStatus: data.status,
            };
          }
        }
      } catch {
        dbConnected = false;
      }
    }

    return NextResponse.json({
      ok: true,
      status: "ok",
      service: "fantasy-war-room",
      version: "0.1.0",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || "development",
      demoMode: process.env.NEXT_PUBLIC_DEMO_MODE === "true" || !adminConfigured,
      supabase: {
        configured: supabaseConfigured,
        adminConfigured,
        connected: dbConnected,
      },
      scout: lastScoutRun,
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        status: "degraded",
        service: "fantasy-war-room",
        error: String(error),
        timestamp: new Date().toISOString(),
      },
      { status: 500 }
    );
  }
}
