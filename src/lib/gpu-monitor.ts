import { execSync } from "child_process";

export interface GpuStats {
  utilization: number | null;
  cap: number;
  isThrottled: boolean;
  activeModel: string;
  recommendedModel: string;
  inUseMemoryMb: number | null;
  allocatedMemoryMb: number | null;
  timestamp: string;
}

const GPU_CAP = 60; // 60% GPU Usage Cap as requested by user

export function getGpuStats(): GpuStats {
  let utilization: number | null = null;
  let inUseMemoryMb: number | null = null;
  let allocatedMemoryMb: number | null = null;

  try {
    const output = execSync("ioreg -r -c IOAccelerator", {
      encoding: "utf-8",
      timeout: 1000,
    });

    // Parse Device Utilization %
    const deviceMatch = output.match(/"Device Utilization %"\s*=\s*(\d+)/);
    const rendererMatch = output.match(/"Renderer Utilization %"\s*=\s*(\d+)/);
    const tilerMatch = output.match(/"Tiler Utilization %"\s*=\s*(\d+)/);

    const devUtil = deviceMatch ? parseInt(deviceMatch[1], 10) : 0;
    const rendUtil = rendererMatch ? parseInt(rendererMatch[1], 10) : 0;
    const tileUtil = tilerMatch ? parseInt(tilerMatch[1], 10) : 0;

    utilization = Math.max(devUtil, rendUtil, tileUtil);

    // Parse In use system memory
    const memoryMatch = output.match(/"In use system memory"\s*=\s*(\d+)/);
    if (memoryMatch) {
      inUseMemoryMb = Math.round(parseInt(memoryMatch[1], 10) / (1024 * 1024));
    }

    const allocMatch = output.match(/"Alloc system memory"\s*=\s*(\d+)/);
    if (allocMatch) {
      allocatedMemoryMb = Math.round(parseInt(allocMatch[1], 10) / (1024 * 1024));
    }
  } catch {
    // Vercel and non-macOS hosts do not expose this local macOS metric.
    // Preserve an explicit unavailable value instead of fabricating telemetry.
  }

  const isThrottled = utilization != null && utilization >= GPU_CAP;
  const activeModel = process.env.OPENROUTER_API_KEY
    ? "deepseek/deepseek-v4-pro"
    : "unavailable";

  return {
    utilization,
    cap: GPU_CAP,
    isThrottled,
    activeModel,
    recommendedModel: activeModel,
    inUseMemoryMb,
    allocatedMemoryMb,
    timestamp: new Date().toISOString(),
  };
}
