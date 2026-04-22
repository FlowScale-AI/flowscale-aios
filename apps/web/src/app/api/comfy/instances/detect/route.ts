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

  // Guardrail: GPU detection is platform-fragile (nvidia-smi/rocm-smi/lspci may
  // be missing or return nothing on Windows AMD, for example). If we detected
  // zero GPUs but the user already has GPU instances configured, keep their
  // config and surface a warning — overwriting with a CPU-only list would lose
  // per-instance launch-script assignments and make the UI seem broken.
  const existing = getComfyInstances()
  const existingHasGpu = existing.some((i) => i.device !== 'cpu')
  if (gpus.length === 0 && existingHasGpu) {
    return NextResponse.json({
      gpus,
      instances: existing,
      warning:
        'No GPUs detected — keeping existing instance configuration. ' +
        'On Windows, ensure nvidia-smi is on PATH for NVIDIA or that rocm-smi/lspci are available for AMD.',
    })
  }

  const basePort = getComfyManagedPort()
  const instances: ComfyInstanceConfig[] = []

  // Preserve per-instance settings (e.g. launchScriptId) across re-detection
  // when the GPU still exists — keyed by the stable `id` (`gpu-0`, `cpu`, ...).
  const existingById = new Map(existing.map((i) => [i.id, i]))

  // One instance per GPU
  for (let i = 0; i < gpus.length; i++) {
    const gpu = gpus[i]
    const devicePrefix = gpu.backend === 'rocm' ? 'rocm' : 'cuda'
    const id = `gpu-${gpu.index}`
    const prior = existingById.get(id)
    instances.push({
      id,
      port: basePort + i,
      device: `${devicePrefix}:${gpu.index}`,
      label: `GPU ${gpu.index} — ${gpu.name}`,
      ...(prior?.launchScriptId ? { launchScriptId: prior.launchScriptId } : {}),
    })
  }

  // Always add a CPU instance (carry over its launchScriptId if it existed)
  const priorCpu = existingById.get('cpu')
  instances.push({
    id: 'cpu',
    port: basePort + gpus.length,
    device: 'cpu',
    label: 'CPU',
    ...(priorCpu?.launchScriptId ? { launchScriptId: priorCpu.launchScriptId } : {}),
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
