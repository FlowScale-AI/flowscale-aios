/**
 * ComfyUI multi-instance process lifecycle manager.
 *
 * Manages N+1 ComfyUI processes (one per GPU + one CPU-only).
 * Each instance is identified by a stable ID (e.g. 'gpu-0', 'cpu').
 * State is persisted to per-instance PID files so it survives Next.js hot-reloads.
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'fs'
import { createConnection } from 'net'
import path from 'path'
import os from 'os'
import { getComfyManagedPath, getComfyInstances, getComfyInstanceById } from './providerSettings'

const AIOS_DIR = path.join(os.homedir(), '.flowscale', 'aios')

function pidFile(instanceId: string): string {
  return path.join(AIOS_DIR, `comfyui-${instanceId}.pid`)
}

// In-process references — survive route re-use within one Node process, but
// will be null after a hot-reload.  PID files are the persistent source of truth.
const comfyProcesses = new Map<string, ChildProcess>()

export type ComfyStatus = 'running' | 'starting' | 'stopping' | 'stopped'

export interface InstanceStatusResult {
  id: string
  alive: boolean
  pid: number | null
  port: number
  device: string
  label: string
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writePid(instanceId: string, pid: number): void {
  mkdirSync(AIOS_DIR, { recursive: true })
  writeFileSync(pidFile(instanceId), String(pid), 'utf-8')
}

function readPid(instanceId: string): number | null {
  try {
    const raw = readFileSync(pidFile(instanceId), 'utf-8').trim()
    const pid = parseInt(raw, 10)
    return isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

function removePid(instanceId: string): void {
  try { unlinkSync(pidFile(instanceId)) } catch { /* ignore */ }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

/** Returns the best Python executable for the given ComfyUI installation. */
function findPythonExec(comfyPath: string): string {
  const isWin = process.platform === 'win32'

  const candidates = isWin
    ? [
        path.join(comfyPath, 'venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(comfyPath, 'venv', 'bin', 'python3'),
        path.join(comfyPath, 'venv', 'bin', 'python'),
        // macOS Desktop App bundles Python in the .app Resources sibling dirs:
        path.join(comfyPath, '..', 'python_embeds', 'bin', 'python3'),
        path.join(comfyPath, '..', 'venv', 'bin', 'python3'),
        path.join(comfyPath, '..', 'venv', 'bin', 'python'),
      ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return isWin ? 'python' : 'python3'
}

/** Build the env vars for a specific device assignment. */
function buildDeviceEnv(device: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  if (device === 'cpu') {
    env.CUDA_VISIBLE_DEVICES = ''
    env.HIP_VISIBLE_DEVICES = ''
  } else if (device.startsWith('cuda:')) {
    env.CUDA_VISIBLE_DEVICES = device.split(':')[1]
  } else if (device.startsWith('rocm:')) {
    env.HIP_VISIBLE_DEVICES = device.split(':')[1]
  }
  return env
}

/** Quick TCP check — resolves true if something is listening on the port. */
function isPortInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.setTimeout(1000)
    socket.on('connect', () => { socket.destroy(); resolve(true) })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the current status of a single instance based on the PID file.
 * Does NOT do an HTTP probe — the API route handles that.
 */
export function getInstanceStatus(instanceId: string): InstanceStatusResult {
  const config = getComfyInstanceById(instanceId)
  const port = config?.port ?? 8188
  const device = config?.device ?? 'cuda:0'
  const label = config?.label ?? instanceId

  // Prefer the live process reference first
  const proc = comfyProcesses.get(instanceId)
  if (proc && !proc.killed && proc.pid) {
    const alive = isProcessAlive(proc.pid)
    if (!alive) {
      comfyProcesses.delete(instanceId)
      removePid(instanceId)
    }
    return { id: instanceId, alive, pid: proc.pid ?? null, port, device, label }
  }

  // Fall back to PID file
  const pid = readPid(instanceId)
  if (!pid) return { id: instanceId, alive: false, pid: null, port, device, label }

  if (isProcessAlive(pid)) return { id: instanceId, alive: true, pid, port, device, label }

  // Stale PID — clean up
  removePid(instanceId)
  return { id: instanceId, alive: false, pid: null, port, device, label }
}

/** Returns the status of all configured instances. */
export function getAllInstanceStatuses(): InstanceStatusResult[] {
  return getComfyInstances().map((cfg) => getInstanceStatus(cfg.id))
}

/**
 * Detect external (non-AIOS) ComfyUI processes running on a given device.
 * Looks for `python.*main.py --port` processes (ComfyUI's signature) and checks
 * their CUDA_VISIBLE_DEVICES / HIP_VISIBLE_DEVICES env vars.
 * Returns the PID if found, null otherwise.
 */
function findExternalComfyOnDevice(device: string): number | null {
  if (process.platform !== 'linux') return null // /proc required

  // Collect PIDs and ports managed by AIOS so we can exclude them.
  // Check PID files, in-memory process map, and configured ports.
  const aiosPids = new Set<number>()
  const aiosPorts = new Set<string>()
  for (const cfg of getComfyInstances()) {
    aiosPorts.add(String(cfg.port))
    const pid = readPid(cfg.id)
    if (pid && isProcessAlive(pid)) aiosPids.add(pid)
    // Also check in-memory references (survives hot-reload gaps where PID file is lost)
    const proc = comfyProcesses.get(cfg.id)
    if (proc?.pid && !proc.killed) aiosPids.add(proc.pid)
  }

  try {
    // Match python processes running main.py with --port (ComfyUI's launch signature)
    const raw = execSync(
      "ps -eo pid,args --no-headers | grep '[p]ython.*main\\.py.*--port'",
      { encoding: 'utf-8', timeout: 3000 },
    )
    for (const line of raw.trim().split('\n')) {
      if (!line.trim()) continue
      const match = line.trim().match(/^(\d+)\s+/)
      if (!match) continue
      const pid = parseInt(match[1], 10)
      if (aiosPids.has(pid)) continue // skip AIOS-managed (by PID)

      // Also skip if running on an AIOS-configured port
      const portMatch = line.match(/--port\s+(\d+)/)
      if (portMatch && aiosPorts.has(portMatch[1])) continue

      // Read the process's env to check device assignment
      try {
        const envRaw = readFileSync(`/proc/${pid}/environ`, 'utf-8')
        const envVars = envRaw.split('\0')

        if (device === 'cpu') {
          // CPU instance: external ComfyUI with --cpu flag
          if (line.includes('--cpu')) return pid
        } else {
          const gpuIndex = device.split(':')[1]
          const envKey = device.startsWith('rocm:') ? 'HIP_VISIBLE_DEVICES' : 'CUDA_VISIBLE_DEVICES'
          const entry = envVars.find((e) => e.startsWith(`${envKey}=`))
          const value = entry?.split('=')[1] ?? ''
          // Match if env var targets the same GPU index, or if it's unset
          // (unset means all GPUs visible — conflict on any device)
          if (value === gpuIndex || (!entry && device !== 'cpu')) return pid
        }
      } catch {
        // Can't read /proc/PID/environ — permission denied, skip
      }
    }
  } catch {
    // grep found nothing or ps failed — no external instances
  }
  return null
}

/**
 * Starts a specific ComfyUI instance. Returns immediately after spawning.
 * Throws if configuration is missing, binary can't be found, or port is already in use.
 */
export async function startInstance(instanceId: string): Promise<{ port: number; pid: number }> {
  const config = getComfyInstanceById(instanceId)
  if (!config) throw new Error(`Unknown ComfyUI instance: ${instanceId}`)

  // Guard: don't start if an external ComfyUI is already using this device
  const externalPid = findExternalComfyOnDevice(config.device)
  if (externalPid) {
    throw new Error(
      `Another ComfyUI instance (PID ${externalPid}) is already running on ${config.label}. ` +
      `Stop the external instance first, then try again.`,
    )
  }

  // Guard: don't start if something is already listening on this port
  if (await isPortInUse(config.port)) {
    throw new Error(`Port ${config.port} is already in use — a ComfyUI instance may already be running for ${config.label}`)
  }

  const comfyPath = getComfyManagedPath()
  if (!comfyPath) throw new Error('ComfyUI path not configured. Please complete the setup first.')
  if (!existsSync(comfyPath)) throw new Error(`ComfyUI directory not found: ${comfyPath}`)

  const mainPy = path.join(comfyPath, 'main.py')
  if (!existsSync(mainPy)) {
    throw new Error(`ComfyUI main.py not found at: ${mainPy}. Is this a valid ComfyUI installation?`)
  }

  const python = findPythonExec(comfyPath)
  const env = buildDeviceEnv(config.device)

  const child = spawn(
    python,
    [mainPy, '--port', String(config.port), '--listen', '127.0.0.1', ...(config.device === 'cpu' ? ['--cpu'] : [])],
    {
      cwd: comfyPath,
      detached: false,
      stdio: 'pipe',
      env,
    },
  )

  comfyProcesses.set(instanceId, child)

  if (child.pid) {
    writePid(instanceId, child.pid)
  }

  child.stdout?.on('data', () => { /* consumed to avoid back-pressure */ })
  child.stderr?.on('data', () => { /* consumed to avoid back-pressure */ })

  child.on('exit', () => {
    comfyProcesses.delete(instanceId)
    removePid(instanceId)
  })

  if (!child.pid) throw new Error(`Failed to spawn ComfyUI instance ${instanceId}`)

  return { port: config.port, pid: child.pid }
}

/** Sends SIGTERM to a managed ComfyUI instance (SIGKILL after 5 s). */
export function stopInstance(instanceId: string): void {
  const proc = comfyProcesses.get(instanceId)
  if (proc && !proc.killed) {
    proc.kill('SIGTERM')
    const p = proc
    setTimeout(() => {
      if (!p.killed) p.kill('SIGKILL')
    }, 5000)
    comfyProcesses.delete(instanceId)
  } else {
    // Try via PID file (hot-reload case)
    const pid = readPid(instanceId)
    if (pid && isProcessAlive(pid)) {
      try { process.kill(pid, 'SIGTERM') } catch { /* ignore */ }
      setTimeout(() => {
        if (isProcessAlive(pid)) {
          try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
        }
      }, 5000)
    }
  }
  removePid(instanceId)
}

/** Stops then immediately restarts an instance. */
export async function restartInstance(instanceId: string): Promise<{ port: number; pid: number }> {
  stopInstance(instanceId)
  return startInstance(instanceId)
}

/** Starts all configured instances (skips those whose port is already in use). */
export async function startAll(): Promise<Array<{ id: string; port: number; pid: number }>> {
  const results: Array<{ id: string; port: number; pid: number }> = []
  for (const cfg of getComfyInstances()) {
    try {
      const { port, pid } = await startInstance(cfg.id)
      results.push({ id: cfg.id, port, pid })
    } catch {
      // Skip instances that can't start (e.g. port already in use)
    }
  }
  return results
}

/** Stops all running instances. */
export function stopAll(): void {
  for (const cfg of getComfyInstances()) {
    stopInstance(cfg.id)
  }
}

/** Kills all instances found by PID file glob (used by Electron cleanup). */
export function killAllByPidFiles(): void {
  try {
    const files = readdirSync(AIOS_DIR).filter(
      (f) => f.startsWith('comfyui-') && f.endsWith('.pid'),
    )
    for (const f of files) {
      const fullPath = path.join(AIOS_DIR, f)
      try {
        const pid = parseInt(readFileSync(fullPath, 'utf-8').trim(), 10)
        if (!isNaN(pid) && pid > 0) {
          try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
        }
      } catch { /* ignore */ }
      try { unlinkSync(fullPath) } catch { /* ignore */ }
    }
  } catch { /* AIOS_DIR may not exist */ }
}

// ─── Legacy compatibility ────────────────────────────────────────────────────
// These re-export the old single-instance API for callers that haven't been
// updated yet. They operate on the first configured instance.

/** @deprecated Use getInstanceStatus / getAllInstanceStatuses */
export function getProcessStatus(): { alive: boolean; pid: number | null; port: number } {
  const instances = getComfyInstances()
  if (instances.length === 0) return { alive: false, pid: null, port: 8188 }
  const st = getInstanceStatus(instances[0].id)
  return { alive: st.alive, pid: st.pid, port: st.port }
}

/** @deprecated Use startInstance */
export async function startComfyUI(): Promise<{ port: number; pid: number }> {
  const instances = getComfyInstances()
  if (instances.length === 0) throw new Error('No ComfyUI instances configured')
  return startInstance(instances[0].id)
}

/** @deprecated Use stopInstance / stopAll */
export function stopComfyUI(): void {
  stopAll()
}

/** @deprecated Use restartInstance */
export async function restartComfyUI(): Promise<{ port: number; pid: number }> {
  const instances = getComfyInstances()
  if (instances.length === 0) throw new Error('No ComfyUI instances configured')
  return restartInstance(instances[0].id)
}
