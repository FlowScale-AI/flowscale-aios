/**
 * GPU re-detection that updates ComfyUI instance configs in place.
 *
 * Used by:
 *   - POST /api/comfy/instances/detect (manual user trigger)
 *   - instrumentation.ts (automatic on every server boot)
 *
 * Safeguards:
 *   - If detection returns zero GPUs but configs already have GPU instances,
 *     keep the existing configs (detection is platform-fragile and can fail
 *     transiently — a stale config beats blowing it away).
 *   - Per-instance customizations (launchScriptId, customLabel) are preserved
 *     across re-detection, keyed by stable instance id (`gpu-0`, `cpu`, ...).
 *   - Pure / synchronous return — caller decides whether to await or fire-and-forget.
 */

import { detectGpus, clearGpuCache, type GpuInfo } from './gpu-detect'
import {
  getComfyInstances,
  setComfyInstances,
  getComfyManagedPort,
  type ComfyInstanceConfig,
} from './providerSettings'

export interface DetectAndUpdateResult {
  gpus: GpuInfo[]
  instances: ComfyInstanceConfig[]
  /** True if the instance list was rewritten in settings.json. */
  changed: boolean
  /** Set when detection returned [] but there were existing GPU instances. */
  warning?: string
}

/**
 * Build the new instance list from detected GPUs, merging in existing
 * customizations (launchScriptId, customLabel). Pure — does NOT write to
 * settings. Exported for testing.
 */
export function buildInstancesFromDetection(
  gpus: GpuInfo[],
  existing: ComfyInstanceConfig[],
  basePort: number,
): ComfyInstanceConfig[] {
  const existingById = new Map(existing.map((i) => [i.id, i]))
  const instances: ComfyInstanceConfig[] = []

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
      gpuName: gpu.name,
      ...(prior?.launchScriptId ? { launchScriptId: prior.launchScriptId } : {}),
      ...(prior?.customLabel ? { customLabel: prior.customLabel } : {}),
    })
  }

  const priorCpu = existingById.get('cpu')
  instances.push({
    id: 'cpu',
    port: basePort + gpus.length,
    device: 'cpu',
    label: 'CPU',
    ...(priorCpu?.launchScriptId ? { launchScriptId: priorCpu.launchScriptId } : {}),
  })

  return instances
}

/**
 * True when two instance lists are functionally equivalent (same id/port/device/
 * gpuName/label/launchScriptId/customLabel for each entry, in order). Used to
 * skip writing to settings.json when nothing meaningful would change.
 */
export function instancesEqual(a: ComfyInstanceConfig[], b: ComfyInstanceConfig[]): boolean {
  if (a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) {
    const x = a[i]
    const y = b[i]
    if (
      x.id !== y.id ||
      x.port !== y.port ||
      x.device !== y.device ||
      x.label !== y.label ||
      x.gpuName !== y.gpuName ||
      x.launchScriptId !== y.launchScriptId ||
      x.customLabel !== y.customLabel
    ) {
      return false
    }
  }
  return true
}

/** Run detection + update instance configs. Used by the API route + startup hook. */
export function detectAndUpdateInstances(opts?: { forceClearCache?: boolean }): DetectAndUpdateResult {
  if (opts?.forceClearCache) clearGpuCache()
  const gpus = detectGpus()

  const existing = getComfyInstances()
  const existingHasGpu = existing.some((i) => i.device !== 'cpu')

  // Detection failed AND we have existing GPU instances → keep them. Avoids
  // wiping a known-good config when nvidia-smi/rocm-smi temporarily fails.
  if (gpus.length === 0 && existingHasGpu) {
    return {
      gpus,
      instances: existing,
      changed: false,
      warning:
        'No GPUs detected — keeping existing instance configuration. ' +
        'On Windows, ensure nvidia-smi is on PATH for NVIDIA or that rocm-smi/lspci are available for AMD.',
    }
  }

  const basePort = getComfyManagedPort()
  const instances = buildInstancesFromDetection(gpus, existing, basePort)

  if (instancesEqual(existing, instances)) {
    // No-op — don't trigger settings.json writes / file watcher churn.
    return { gpus, instances: existing, changed: false }
  }

  setComfyInstances(instances)
  return { gpus, instances, changed: true }
}
