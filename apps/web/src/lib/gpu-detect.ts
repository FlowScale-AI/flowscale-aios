/**
 * GPU enumeration for multi-instance ComfyUI support.
 * Detects available GPUs (NVIDIA via nvidia-smi, AMD via rocm-smi + lspci).
 */

import { execSync } from 'child_process'

export interface GpuInfo {
  index: number
  name: string
  vramMB: number
  backend: 'cuda' | 'rocm'
}

let cachedGpus: GpuInfo[] | null = null

function detectNvidiaGpus(): GpuInfo[] {
  try {
    const raw = execSync(
      'nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 5000 },
    ).trim()
    if (!raw) return []
    return raw.split('\n').map((line) => {
      const [idx, name, vram] = line.split(',').map((s) => s.trim())
      return {
        index: parseInt(idx, 10),
        name,
        vramMB: Math.round(parseFloat(vram)),
        backend: 'cuda' as const,
      }
    })
  } catch {
    return []
  }
}

/** Get GPU names from lspci (works when rocm-smi can't resolve names). */
function getGpuNamesFromLspci(): string[] {
  try {
    const lspciOutput = execSync('lspci', { encoding: 'utf-8', timeout: 5000 }).trim()
    if (!lspciOutput) return []
    const raw = lspciOutput
      .split('\n')
      .filter((line) => /vga|3d|display/i.test(line))
      .join('\n')
    if (!raw) return []
    // Extract the device description after the colon
    // e.g. "03:00.0 VGA compatible controller: AMD ... Navi 32 [Radeon RX 7700 XT / 7800 XT]"
    return raw.split('\n').map((line) => {
      // Find all bracketed groups in the line
      const brackets = [...line.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1])
      // Last bracket is typically the model name e.g. "Radeon RX 7700 XT / 7800 XT"
      // First bracket is vendor e.g. "AMD/ATI"
      if (brackets.length >= 2) return brackets[brackets.length - 1]
      // For lines like "... Raphael (rev c3)" with no model bracket,
      // extract the chip name after the vendor bracket
      const afterVendor = line.match(/\[AMD\/ATI\]\s+([^[(]+)/)
      if (afterVendor) return afterVendor[1].trim()
      if (brackets.length === 1) return brackets[0]
      // Fallback: everything after "controller: "
      const ctrlMatch = line.match(/controller:\s*(.+)/)
      return ctrlMatch ? ctrlMatch[1].trim() : 'AMD GPU'
    })
  } catch {
    return []
  }
}

function detectRocmGpus(): GpuInfo[] {
  try {
    // Parse VRAM info (reliable output format)
    const vramRaw = execSync('rocm-smi --showmeminfo vram', {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()

    // Parse lines like: "GPU[0]		: VRAM Total Memory (B): 12868124672"
    const vramMap = new Map<number, number>()
    for (const line of vramRaw.split('\n')) {
      const match = line.match(/GPU\[(\d+)\]\s*:\s*VRAM Total Memory \(B\):\s*(\d+)/)
      if (match) {
        vramMap.set(parseInt(match[1], 10), Math.round(parseInt(match[2], 10) / (1024 * 1024)))
      }
    }

    if (vramMap.size === 0) return []

    // Get names from lspci (more reliable than rocm-smi --showproductname)
    const lspciNames = getGpuNamesFromLspci()

    // rocm-smi GPU indices correspond to lspci order for AMD devices
    const gpus: GpuInfo[] = []
    for (const [idx, vramMB] of vramMap) {
      gpus.push({
        index: idx,
        name: lspciNames[idx] || `AMD GPU ${idx}`,
        vramMB,
        backend: 'rocm' as const,
      })
    }

    return gpus.sort((a, b) => a.index - b.index)
  } catch {
    return []
  }
}

/**
 * Returns all detected GPUs on the system.
 * Result is cached for the lifetime of the Node process.
 */
export function detectGpus(): GpuInfo[] {
  if (cachedGpus !== null) return cachedGpus

  // Try NVIDIA first, then ROCm
  let gpus = detectNvidiaGpus()
  if (gpus.length === 0) {
    gpus = detectRocmGpus()
  }

  cachedGpus = gpus
  return gpus
}

/** Clear the cache (useful for re-detection). */
export function clearGpuCache(): void {
  cachedGpus = null
}
