import { NextResponse } from 'next/server'
import { detectGpus, clearGpuCache } from '@/lib/gpu-detect'
import { getComfyInstances, setComfyInstances, getComfyManagedPort, type ComfyInstanceConfig } from '@/lib/providerSettings'

/**
 * POST /api/comfy/instances/detect
 *
 * Detects available GPUs, generates an instance config (one per GPU + one CPU),
 * saves to settings, and returns the result.
 */
export async function POST() {
  // Clear cache so we re-detect
  clearGpuCache()
  const gpus = detectGpus()

  const basePort = getComfyManagedPort()
  const instances: ComfyInstanceConfig[] = []

  // One instance per GPU
  for (let i = 0; i < gpus.length; i++) {
    const gpu = gpus[i]
    const devicePrefix = gpu.backend === 'rocm' ? 'rocm' : 'cuda'
    instances.push({
      id: `gpu-${gpu.index}`,
      port: basePort + i,
      device: `${devicePrefix}:${gpu.index}`,
      label: `GPU ${gpu.index} — ${gpu.name}`,
    })
  }

  // Always add a CPU instance
  instances.push({
    id: 'cpu',
    port: basePort + gpus.length,
    device: 'cpu',
    label: 'CPU',
  })

  setComfyInstances(instances)

  return NextResponse.json({ gpus, instances })
}

/**
 * GET /api/comfy/instances/detect
 *
 * Returns current instance config without re-detecting.
 */
export async function GET() {
  const instances = getComfyInstances()
  return NextResponse.json({ instances })
}
