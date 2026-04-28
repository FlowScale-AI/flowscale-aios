/**
 * GPU enumeration for multi-instance ComfyUI support.
 * Detects available GPUs (NVIDIA via nvidia-smi, AMD via rocm-smi + lspci).
 */

import { execSync, execFileSync } from 'child_process'
import { writeFileSync, unlinkSync, mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import * as path from 'path'
import { getComfyUIPath } from './providerSettings'
import { findPythonExec } from './comfyui-manager'

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
 * Windows-specific AMD GPU detection via registry. Works because
 * `rocm-smi` + `lspci` (used on Linux) don't exist on Windows.
 *
 * Reads the VRAM from `HardwareInformation.qwMemorySize` (64-bit, accurate
 * for cards >4 GB) instead of `Win32_VideoController.AdapterRAM` (32-bit,
 * wraps at ~4 GB).
 */
/**
 * Parse PowerShell registry output (NAME\tVRAM_BYTES per line) into AMD GPUs
 * ordered to match HIP's enumeration on Windows. Exported for testing.
 *
 * HIP on Windows enumerates discrete GPUs before integrated ones — using
 * Windows registry enumeration order gives the *opposite* of HIP, which
 * causes AIOS to point HIP_VISIBLE_DEVICES at the wrong card. Sorting by
 * VRAM descending matches HIP's order in practice (discrete cards have
 * more dedicated VRAM than iGPUs, which share system memory).
 */
export function parseAmdGpusFromRegistry(raw: string): GpuInfo[] {
  if (!raw) return []
  const parsed: Array<{ name: string; vramMB: number }> = []
  for (const line of raw.split(/\r?\n/)) {
    const [name, vramStr] = line.split('\t')
    if (!name || !vramStr) continue
    if (!/amd|radeon|ati/i.test(name)) continue
    const vramBytes = Number(vramStr.trim())
    if (!Number.isFinite(vramBytes)) continue
    const vramMB = Math.round(vramBytes / (1024 * 1024))
    parsed.push({ name: name.trim(), vramMB })
  }
  // Sort by VRAM descending so the discrete card lands at index 0 — matches
  // HIP_VISIBLE_DEVICES enumeration. Stable for ties on the off chance of
  // matched VRAM (rare for iGPU + discrete).
  parsed.sort((a, b) => b.vramMB - a.vramMB)
  return parsed.map((g, index) => ({
    index,
    name: g.name,
    vramMB: g.vramMB,
    backend: 'rocm' as const,
  }))
}

function detectAmdGpusWindows(): GpuInfo[] {
  try {
    // PowerShell snippet outputs lines: NAME\tVRAM_BYTES.
    // Passed via -EncodedCommand (UTF-16-LE + base64) to avoid cmd.exe
    // quoting issues with embedded quotes / backticks.
    const ps =
      "$items = Get-ItemProperty 'HKLM:\\SYSTEM\\CurrentControlSet\\Control\\Class\\{4d36e968-e325-11ce-bfc1-08002be10318}\\*' -ErrorAction SilentlyContinue;" +
      "foreach ($item in $items) {" +
      "  $mem = $item.'HardwareInformation.qwMemorySize';" +
      "  if ($mem -ne $null) { Write-Output ($item.DriverDesc + [char]9 + $mem) }" +
      "}"
    const encoded = Buffer.from(ps, 'utf16le').toString('base64')

    const raw = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand ${encoded}`, {
      encoding: 'utf-8',
      timeout: 5000,
    }).trim()

    return parseAmdGpusFromRegistry(raw)
  } catch {
    return []
  }
}

/**
 * Authoritative GPU detection via ComfyUI's bundled PyTorch. Whatever this returns
 * is exactly what ComfyUI will see — including the indices HIP_VISIBLE_DEVICES and
 * CUDA_VISIBLE_DEVICES select against.
 *
 * Preferred over registry/nvidia-smi/rocm-smi because it resolves the Windows
 * iGPU-vs-discrete enumeration mismatch: HIP on Windows skips iGPUs, so Windows
 * adapter index 1 can end up as HIP index 0. Asking torch directly avoids that.
 */
function detectGpusViaTorch(): GpuInfo[] | null {
  const comfyPath = getComfyUIPath()
  if (!comfyPath) return null
  let python: string
  try { python = findPythonExec(comfyPath) } catch { return null }

  // Emit TSV on stdout: "cuda|rocm\tindex\tname\tvramMB" per device.
  const script = [
    'import sys, json',
    'try:',
    '    import torch',
    '    n = torch.cuda.device_count()',
    '    backend = "rocm" if getattr(torch.version, "hip", None) else "cuda"',
    '    rows = []',
    '    for i in range(n):',
    '        p = torch.cuda.get_device_properties(i)',
    '        rows.append([backend, i, p.name, int(p.total_memory // (1024*1024))])',
    '    print(json.dumps(rows))',
    'except Exception as e:',
    '    print("ERR:" + str(e), file=sys.stderr); sys.exit(1)',
  ].join('\n')

  // Write script to a temp file rather than piping via stdin — stdin-driven
  // python invocations fail with STATUS_DLL_INIT_FAILED (0xC0000142) in some
  // Next.js dev environments on Windows when the venv python needs to locate
  // DLLs relative to its own directory during init.
  const tmpDir = mkdtempSync(path.join(tmpdir(), 'flowscale-gpudetect-'))
  const scriptFile = path.join(tmpDir, 'detect.py')
  writeFileSync(scriptFile, script, 'utf-8')

  try {
    // cwd = python's own directory so Windows DLL resolution finds sibling
    // DLLs first (matters for relocated venvs and ComfyUI Desktop bundles).
    const raw = execFileSync(python, [scriptFile], {
      encoding: 'utf-8',
      timeout: 15_000,
      cwd: path.dirname(python),
    }).trim()
    if (!raw) return null
    const rows = JSON.parse(raw) as Array<[string, number, string, number]>
    return rows.map(([backend, index, name, vramMB]) => ({
      index,
      name,
      vramMB,
      backend: backend === 'rocm' ? 'rocm' : 'cuda',
    }))
  } catch {
    return null
  } finally {
    try { unlinkSync(scriptFile) } catch { /* ignore */ }
  }
}

/**
 * Returns all detected GPUs on the system.
 * Successful detections (non-empty) are cached for the lifetime of the Node
 * process. Empty results are NOT cached — early-startup calls before ComfyUI
 * is configured shouldn't poison detection forever, and downstream conflict
 * checks rely on fresh data once a torch venv becomes available.
 */
export function detectGpus(): GpuInfo[] {
  if (cachedGpus !== null && cachedGpus.length > 0) return cachedGpus

  // Prefer torch — authoritative and correctly indexed for ComfyUI (HIP and
  // CUDA both expose devices in the same order torch sees them).
  let gpus = detectGpusViaTorch() ?? []

  // Fall back to tool-based detection when ComfyUI's Python isn't available
  // (e.g. first-time install before ComfyUI is configured).
  if (gpus.length === 0) gpus = detectNvidiaGpus()
  if (gpus.length === 0) gpus = detectRocmGpus()
  if (gpus.length === 0 && process.platform === 'win32') {
    gpus = detectAmdGpusWindows()
  }

  cachedGpus = gpus
  return gpus
}

/** Clear the cache (useful for re-detection). */
export function clearGpuCache(): void {
  cachedGpus = null
}

/**
 * Returns a human-readable CPU name for the current system.
 * Works on macOS (Apple Silicon / Intel), Linux, and Windows.
 */
export function getCpuName(): string {
  try {
    if (process.platform === 'darwin') {
      // macOS: "Apple M2 Pro", "Apple M1 Max", etc.
      const chip = execSync('sysctl -n machdep.cpu.brand_string', {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim()
      if (chip) return chip
    } else if (process.platform === 'linux') {
      const raw = execSync("grep -m1 'model name' /proc/cpuinfo", {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim()
      const match = raw.match(/:\s*(.+)/)
      if (match) return match[1].trim()
    } else if (process.platform === 'win32') {
      const raw = execSync('wmic cpu get name', {
        encoding: 'utf-8',
        timeout: 3000,
      }).trim()
      const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
      if (lines.length > 1) return lines[1]
    }
  } catch {
    // fall through
  }
  return 'CPU'
}

export interface GpuUtilization {
  index: number
  vramUsedMB: number
  vramTotalMB: number
  gpuUtil: number
}

/**
 * Returns real-time GPU utilization (VRAM usage + GPU %).
 * NOT cached — intended for polling.
 * Only supports NVIDIA GPUs (via nvidia-smi). Returns empty array for AMD/ROCm.
 */
export function getGpuUtilization(): GpuUtilization[] {
  try {
    const raw = execSync(
      'nvidia-smi --query-gpu=index,memory.used,memory.total,utilization.gpu --format=csv,noheader,nounits',
      { encoding: 'utf-8', timeout: 5000 },
    ).trim()
    if (!raw) return []
    return raw.split('\n').map((line) => {
      const [idx, used, total, util] = line.split(',').map((s) => s.trim())
      return {
        index: parseInt(idx, 10),
        vramUsedMB: Math.round(parseFloat(used)),
        vramTotalMB: Math.round(parseFloat(total)),
        gpuUtil: Math.round(parseFloat(util)),
      }
    })
  } catch {
    return []
  }
}
