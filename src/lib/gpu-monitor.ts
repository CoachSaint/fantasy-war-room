import { execSync } from "child_process";

export interface GpuStats {
  utilization: number;
  cap: number;
  isThrottled: boolean;
  activeModel: string;
  recommendedModel: string;
  inUseMemoryMb: number;
  allocatedMemoryMb: number;
  timestamp: string;
}

const GPU_CAP = 60; // 60% GPU Usage Cap as requested by user

export function getGpuStats(): GpuStats {
  let utilization = 0;
  let inUseMemoryMb = 0;
  let allocatedMemoryMb = 0;

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
  } catch (e) {
    // Fallback simulated utilization for dev environment if ioreg command fails
    utilization = 18;
  }

  const isThrottled = utilization >= GPU_CAP;
  
  // High GPU usage (>60%) forces fallback to lightweight 4B model to keep system performant
  const recommendedModel = isThrottled
    ? "qwen/qwen3-4b-2507"
    : "qwen/qwen3-coder-30b";

  return {
    utilization,
    cap: GPU_CAP,
    isThrottled,
    activeModel: recommendedModel,
    recommendedModel,
    inUseMemoryMb: inUseMemoryMb || 1024,
    allocatedMemoryMb: allocatedMemoryMb || 20480,
    timestamp: new Date().toISOString(),
  };
}
