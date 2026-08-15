import { NextResponse } from "next/server";
import { getGpuStats } from "@/lib/gpu-monitor";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const stats = getGpuStats();
    return NextResponse.json(stats);
  } catch (error) {
    return NextResponse.json(
      {
        utilization: null,
        cap: 60,
        isThrottled: false,
        activeModel: "unavailable",
        recommendedModel: "unavailable",
        inUseMemoryMb: null,
        allocatedMemoryMb: null,
        timestamp: new Date().toISOString(),
        error: String(error),
      },
      { status: 500 }
    );
  }
}
