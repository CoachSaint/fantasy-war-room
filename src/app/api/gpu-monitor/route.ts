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
        utilization: 0,
        cap: 60,
        isThrottled: false,
        activeModel: "qwen/qwen3-coder-30b",
        recommendedModel: "qwen/qwen3-coder-30b",
        inUseMemoryMb: 0,
        allocatedMemoryMb: 0,
        timestamp: new Date().toISOString(),
        error: String(error),
      },
      { status: 500 }
    );
  }
}
