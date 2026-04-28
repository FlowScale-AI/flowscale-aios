/**
 * ComfyUI multi-instance process lifecycle manager.
 *
 * Manages N+1 ComfyUI processes (one per GPU + one CPU-only).
 * Each instance is identified by a stable ID (e.g. 'gpu-0', 'cpu').
 * State is persisted to per-instance PID files so it survives Next.js hot-reloads.
 */

import { spawn, execSync, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync, createWriteStream, statSync } from 'fs'
import { createConnection, createServer } from 'net'
import path from 'path'
import os from 'os'
import { getComfyManagedPath, getComfyInstances, getComfyInstanceById, getComfyPythonPath, getComfyBaseDirectory, getCustomScripts, getComfyDesktopUserDataPath, getExtraComfyPorts } from './providerSettings'
import { detectGpus } from './gpu-detect'
import { WELL_KNOWN_COMFY_PORTS } from './comfy-probe'

const AIOS_DIR = path.join(os.homedir(), '.flowscale', 'aios')

function logFile(instanceId: string): string {
  return path.join(AIOS_DIR, `comfyui-${instanceId}.log`)
}

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

/** Determine the spawn command and args for a custom script based on its extension. */
export function buildScriptSpawnArgs(
  scriptPath: string,
  platform: string = process.platform,
): { cmd: string; args: string[] } {
  const ext = path.extname(scriptPath).toLowerCase()
  if (platform === 'win32') {
    if (ext === '.bat') return { cmd: 'cmd.exe', args: ['/c', scriptPath] }
    if (ext === '.ps1') return { cmd: 'powershell.exe', args: ['-ExecutionPolicy', 'Bypass', '-File', scriptPath] }
  } else if (ext === '.bat' || ext === '.ps1') {
    throw new Error(
      `Script "${path.basename(scriptPath)}" is a Windows-only script (${ext}) and cannot be run on ${platform}. ` +
      `Please provide a .sh script for this platform.`,
    )
  }
  if (ext === '.sh') return { cmd: 'sh', args: [scriptPath] }
  return { cmd: scriptPath, args: [] }
}

/** Returns the best Python executable for the given ComfyUI installation. */
export function findPythonExec(comfyPath: string): string {
  // Explicit user override always wins.
  const override = getComfyPythonPath()
  if (override && existsSync(override)) return override

  const isWin = process.platform === 'win32'

  // ComfyUI Desktop puts its venv inside the user data directory (managed by uv),
  // not next to main.py. Probe that first when a Desktop user-data path is set.
  const desktopUserData = getComfyDesktopUserDataPath()

  const venvNames = ['venv', '.venv']
  const buildVenvCandidates = (root: string): string[] =>
    isWin
      ? venvNames.map((v) => path.join(root, v, 'Scripts', 'python.exe'))
      : venvNames.flatMap((v) => [
          path.join(root, v, 'bin', 'python3'),
          path.join(root, v, 'bin', 'python'),
        ])

  const candidates: string[] = []

  if (desktopUserData) {
    candidates.push(...buildVenvCandidates(desktopUserData))
  }
  candidates.push(...buildVenvCandidates(comfyPath))

  if (!isWin) {
    // macOS Desktop App bundles Python in the .app Resources sibling dirs:
    candidates.push(
      path.join(comfyPath, '..', 'python_embeds', 'bin', 'python3'),
      path.join(comfyPath, '..', 'venv', 'bin', 'python3'),
      path.join(comfyPath, '..', 'venv', 'bin', 'python'),
    )
  }

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
 * Cross-platform device-conflict check. Queries /system_stats on each external
 * ComfyUI (well-known ports + configured managed ports other than ourselves)
 * and returns a matching port if its `devices[]` overlaps with `device`.
 *
 * PyTorch-ROCm presents AMD GPUs as `type: "cuda"` in /system_stats, so a
 * managed `rocm:N` instance conflicts with an external `cuda:N` entry.
 */
/**
 * Defensively clean a stored ComfyUI path before using it at spawn time.
 * Old AIOS versions (and the user's clipboard) sometimes left a trailing
 * `main.py`, wrapping quotes, or trailing path separators in settings.json.
 * Pure / synchronous / exported for tests.
 */
export function normalizeStoredComfyPath(input: string): string {
  if (!input) return ''
  let s = input.trim()
  if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
    s = s.slice(1, -1).trim()
  }
  s = s.replace(/[\\/]+main\.py$/i, '')
  s = s.replace(/[\\/]+$/, '')
  return s
}

/**
 * Normalize a GPU name for comparison across vendor / format variations.
 * Handles:
 *   - Vendor markers: (TM), (R), (C), ™, ®, ©
 *   - Backend prefix: "cuda:0 " / "rocm:1 " (ComfyUI Desktop's /system_stats
 *     prepends this to the device name)
 *   - Backend suffix: " : native" / " : compiled" / similar (Desktop appends
 *     the runtime mode)
 *   - Whitespace normalization
 */
export function normalizeGpuName(s: string | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/\((?:tm|r|c)\)/g, '')
    .replace(/[®™©]/g, '')
    // Strip leading "cuda:N " / "rocm:N " (Desktop /system_stats format)
    .replace(/^(?:cuda|rocm|hip)\s*:\s*\d+\s+/, '')
    // Strip trailing " : <anything>" runtime tag (Desktop /system_stats format)
    .replace(/\s+:\s+\S.*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
}

export interface ExternalDeviceReport { type?: string; index?: number; name?: string }
export interface LocalGpuInfo { index: number; name: string }

/**
 * Merge live GPU detection with persisted instance configs to produce the
 * "what GPUs do we know about" list used by conflict detection. Instance
 * configs are the durable source — `gpuName` is set at setup time and
 * survives detectGpus() returning [] (which happens when ComfyUI's venv
 * is unavailable or the cache was poisoned by an early-startup miss).
 *
 * Detected entries win on duplicate index because torch is authoritative
 * for the current runtime.
 */
export function buildLocalGpuList(
  detected: LocalGpuInfo[],
  instances: Array<{ device: string; gpuName?: string }>,
): LocalGpuInfo[] {
  const detectedIndices = new Set(detected.map((g) => g.index))
  const fromInstances: LocalGpuInfo[] = []
  const seen = new Set<number>()
  for (const inst of instances) {
    if (!inst.gpuName || inst.device === 'cpu') continue
    const idxMatch = inst.device.match(/^(?:cuda|rocm):(\d+)$/)
    if (!idxMatch) continue
    const index = parseInt(idxMatch[1], 10)
    if (detectedIndices.has(index) || seen.has(index)) continue
    seen.add(index)
    fromInstances.push({ index, name: inst.gpuName })
  }
  return [...detected, ...fromInstances]
}

/**
 * Pure decision logic for "does this external ComfyUI conflict with the local
 * device I'm trying to start?" — extracted so it can be unit tested.
 *
 * Returns true if the external should block the local spawn.
 */
export function shouldConflict(
  device: string,
  externalDevices: ExternalDeviceReport[],
  localGpus: LocalGpuInfo[],
): boolean {
  if (device === 'cpu') {
    // CPU instance: conflict only if external has *only* CPU devices.
    return externalDevices.length > 0 && externalDevices.every((d) => d.type === 'cpu')
  }
  const wantIndex = parseInt(device.split(':')[1] ?? '', 10)
  if (!Number.isFinite(wantIndex)) return false
  const nonCpu = externalDevices.filter((d) => d.type !== 'cpu')
  if (nonCpu.length === 0) return false

  const targetGpu = localGpus.find((g) => g.index === wantIndex)
  const targetName = normalizeGpuName(targetGpu?.name)
  const localNames = new Set(localGpus.map((g) => normalizeGpuName(g.name)).filter(Boolean))
  const externalAllNamed = nonCpu.every((d) => !!d.name)

  // 1. Name match against the target — strongest signal, index-independent.
  if (targetName && externalAllNamed) {
    if (nonCpu.some((d) => normalizeGpuName(d.name) === targetName)) return true
    // External names exist but none equal our target.
    // If every external name maps to *some* local GPU (just not our target),
    // we know which physical card it's on → definitely no conflict.
    const allMatchOtherLocal = nonCpu.every((d) =>
      localNames.has(normalizeGpuName(d.name)),
    )
    if (allMatchOtherLocal) return false
    // External names don't match any known local GPU — fall through to
    // index heuristics.
  }

  // 2. Direct index match — only meaningful when *we know* the external isn't
  // env-isolated. PyTorch with HIP_VISIBLE_DEVICES / CUDA_VISIBLE_DEVICES
  // remaps every visible device to index 0, so a single-device external
  // reporting index 0 tells us nothing about which physical GPU it's on.
  if (nonCpu.length > 1 && nonCpu.some((d) => d.index === wantIndex)) return true
  // Multi-device external where one device matches our index AND we have name
  // info that didn't disqualify it above → likely real match.
  if (nonCpu.some((d) => d.index === wantIndex) && !externalAllNamed) return true

  // 3. Single-GPU external with no usable name info — we genuinely cannot
  // tell which physical GPU it's on. Don't conflict here: a false positive
  // (blocking spawns on unrelated GPUs) has bitten users; a false negative
  // (letting two fight for the same GPU) crashes loudly at startup, which
  // the user can recover from. If we have target name but external is
  // unnamed, same thing — we can't reason about it.
  return false
}

async function findExternalComfyOnDeviceViaApi(
  device: string,
  ownInstanceId: string,
): Promise<number | null> {
  const ownPorts = new Set(
    getComfyInstances().filter((i) => i.id !== ownInstanceId).map((i) => i.port),
  )
  // Include user-configured extra scan ports — Desktop App or other launchers
  // often run on non-default ports.
  const extraPorts = getExtraComfyPorts()
  const ports = Array.from(
    new Set<number>([...WELL_KNOWN_COMFY_PORTS, ...ownPorts, ...extraPorts]),
  )

  const localGpus = buildLocalGpuList(
    detectGpus().map((g) => ({ index: g.index, name: g.name })),
    getComfyInstances().map((i) => ({ device: i.device, gpuName: i.gpuName })),
  )

  console.log(
    `[ComfyUI Manager] Probing for external ComfyUI on ${device} (ports: ${ports.join(', ')}, local GPUs: ${localGpus.map((g) => `${g.index}:${g.name}`).join(', ') || 'unknown'})`,
  )

  for (const port of ports) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/system_stats`, {
        signal: AbortSignal.timeout(1500),
      })
      if (!res.ok) continue
      const stats = (await res.json()) as { devices?: ExternalDeviceReport[] }
      const devices = stats.devices ?? []
      console.log(
        `[ComfyUI Manager] :${port} reports devices:`,
        devices.map((d) => `${d.type}:${d.index}${d.name ? ` (${d.name})` : ''}`).join(', '),
      )
      if (shouldConflict(device, devices, localGpus)) {
        console.log(`[ComfyUI Manager] :${port} conflicts with ${device}`)
        return port
      }
    } catch (err) {
      // port not open / not ComfyUI / timeout — skip
      const msg = err instanceof Error ? err.message : String(err)
      if (!/fetch failed|ECONNREFUSED|aborted/i.test(msg)) {
        console.log(`[ComfyUI Manager] :${port} probe error: ${msg}`)
      }
    }
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

  // Guard: Linux /proc scan — catches processes directly (works even if HTTP is slow)
  const externalPid = findExternalComfyOnDevice(config.device)
  if (externalPid) {
    throw new Error(
      `Another ComfyUI instance (PID ${externalPid}) is already running on ${config.label}. ` +
      `Stop the external instance first, then try again.`,
    )
  }

  // Guard: cross-platform check — probe /system_stats on external ComfyUIs
  // to see if they already claim this device. Works on Windows/macOS/Linux.
  const externalPort = await findExternalComfyOnDeviceViaApi(config.device, instanceId)
  if (externalPort) {
    throw new Error(
      `Another ComfyUI is already running on ${config.label} (detected on port ${externalPort}). ` +
      `Stop it first, then try again.`,
    )
  }

  // Guard: don't start if something is already listening on this port
  if (await isPortInUse(config.port)) {
    throw new Error(`Port ${config.port} is already in use — a ComfyUI instance may already be running for ${config.label}`)
  }

  // ── Resolve launch: custom script OR managed python launch ────────────────
  let spawnCmd: string
  let spawnArgs: string[]
  let spawnCwd: string
  let env: NodeJS.ProcessEnv

  const customScript = config.launchScriptId
    ? getCustomScripts().find((s) => s.id === config.launchScriptId)
    : undefined

  if (customScript) {
    // Fail early with a clear error if the script file is missing.
    if (!existsSync(customScript.path)) {
      throw new Error(`Custom script not found: ${customScript.path}. Check the path in Settings → Custom launch scripts.`)
    }
    // Custom script — don't inject GPU env vars; the script owns device selection.
    const { cmd, args: scriptArgs } = buildScriptSpawnArgs(customScript.path)
    spawnCmd = cmd
    spawnArgs = scriptArgs
    spawnCwd = path.dirname(path.resolve(customScript.path))
    env = { ...process.env }
  } else {
    // Managed launch — AIOS builds the command.
    const rawComfyPath = getComfyManagedPath()
    if (!rawComfyPath) throw new Error('ComfyUI path not configured. Please complete the setup first.')
    // Defensively normalize stale settings written before path validation
    // landed (e.g. trailing main.py copied from a stack trace, .app bundles,
    // wrapping quotes). normalizeStoredComfyPath strips the easy mistakes,
    // and existsSync below catches the rest.
    const comfyPath = normalizeStoredComfyPath(rawComfyPath)
    if (!existsSync(comfyPath)) throw new Error(`ComfyUI directory not found: ${comfyPath}`)

    const mainPy = path.join(comfyPath, 'main.py')
    if (!existsSync(mainPy)) {
      throw new Error(
        `ComfyUI main.py not found at: ${mainPy}. Open Settings → ComfyUI → Edit Configuration and re-save the Installation path.`,
      )
    }

    const python = findPythonExec(comfyPath)
    env = buildDeviceEnv(config.device)

    // ComfyUI Desktop ships its frontend as a bundled web dir instead of the
    // pip `comfyui-frontend-package`. When that layout is detected, point
    // main.py at the bundled frontend so it doesn't crash on startup.
    const desktopFrontEnd = path.join(comfyPath, 'web_custom_versions', 'desktop_app')
    const frontEndArgs = existsSync(desktopFrontEnd) ? ['--front-end-root', desktopFrontEnd] : []

    // User-configured data directory — passed as --base-directory so the managed
    // instance shares models/input/output/user with an external ComfyUI workspace.
    const baseDir = getComfyBaseDirectory()
    const baseDirArgs = baseDir && existsSync(baseDir) ? ['--base-directory', baseDir] : []

    spawnCmd = python
    spawnArgs = [
      mainPy,
      '--port', String(config.port),
      '--listen', '127.0.0.1',
      ...frontEndArgs,
      ...baseDirArgs,
      ...(config.device === 'cpu' ? ['--cpu'] : []),
    ]
    spawnCwd = comfyPath
  }

  // Truncate the per-instance log on each start and write a banner so we can
  // distinguish runs. Keeps only the latest boot — rotation isn't needed for
  // debugging "why did this just die" cases.
  mkdirSync(AIOS_DIR, { recursive: true })
  const logStream = createWriteStream(logFile(instanceId), { flags: 'w' })
  // Cap on-disk log size. The API tails the last 16 KB, so losing the middle
  // of a long-running log is acceptable. Prevents unbounded growth from a
  // verbose model spamming stdout.
  const LOG_CAP_BYTES = 10 * 1024 * 1024 // 10 MB
  let logBytesWritten = 0
  let logCapReached = false
  const writeLog = (chunk: string | Buffer) => {
    if (logCapReached) return
    const size = typeof chunk === 'string' ? Buffer.byteLength(chunk) : chunk.length
    if (logBytesWritten + size > LOG_CAP_BYTES) {
      logCapReached = true
      logStream.write('\n[log cap reached — further output suppressed]\n')
      return
    }
    logBytesWritten += size
    logStream.write(chunk)
  }
  writeLog(
    `[${new Date().toISOString()}] spawn: ${spawnCmd} ${spawnArgs.map((a) => (a.includes(' ') ? `"${a}"` : a)).join(' ')}\n` +
    `[cwd] ${spawnCwd}\n` +
    `[device] ${config.device}\n` +
    (customScript ? `[script] ${customScript.label} (${customScript.path})\n` : '') +
    '\n',
  )

  // Any failure between stream creation and handler wiring must not leak the
  // open file descriptor — close it and rethrow.
  let child: ChildProcess
  try {
    child = spawn(spawnCmd, spawnArgs, {
      cwd: spawnCwd,
      detached: false,
      stdio: 'pipe',
      env,
    })
  } catch (err) {
    logStream.write(`\n[${new Date().toISOString()}] spawn threw: ${err instanceof Error ? err.message : String(err)}\n`)
    logStream.end()
    throw err
  }

  comfyProcesses.set(instanceId, child)

  if (child.pid) {
    writePid(instanceId, child.pid)
  }

  child.stdout?.on('data', (buf: Buffer) => { writeLog(buf) })
  child.stderr?.on('data', (buf: Buffer) => { writeLog(buf) })

  child.on('error', (err) => {
    console.error(`ComfyUI instance ${instanceId} spawn error:`, err)
    writeLog(`\n[${new Date().toISOString()}] spawn error: ${err.message}\n`)
    comfyProcesses.delete(instanceId)
    removePid(instanceId)
  })

  child.on('exit', (code, signal) => {
    writeLog(`\n[${new Date().toISOString()}] exit code=${code ?? 'null'} signal=${signal ?? 'null'}\n`)
    logStream.end()
    comfyProcesses.delete(instanceId)
    removePid(instanceId)
  })

  if (!child.pid) {
    logStream.end()
    throw new Error(`Failed to spawn ComfyUI instance ${instanceId}`)
  }

  return { port: config.port, pid: child.pid }
}

/**
 * Returns the last N bytes of a managed instance's log file, or null if the
 * log doesn't exist yet. Used by the UI to surface crash causes.
 */
export function getInstanceLogTail(instanceId: string, bytes = 16_384): string | null {
  const file = logFile(instanceId)
  if (!existsSync(file)) return null
  try {
    const size = statSync(file).size
    const start = Math.max(0, size - bytes)
    const buf = readFileSync(file)
    return buf.slice(start).toString('utf-8')
  } catch {
    return null
  }
}

/**
 * Terminates a process and all its children.
 * On Windows, uses `taskkill /F /T` to kill the entire tree (needed because
 * custom scripts spawn via cmd.exe whose Python child won't die on cmd kill).
 * On Unix, sends SIGTERM with a SIGKILL fallback after 5 s.
 */
export function killProcessTree(pid: number): void {
  if (process.platform === 'win32') {
    try {
      execSync(`taskkill /F /T /PID ${pid}`, { timeout: 5000 })
    } catch { /* process already gone */ }
  } else {
    try { process.kill(pid, 'SIGTERM') } catch { /* already gone */ }
    setTimeout(() => {
      try { process.kill(pid, 'SIGKILL') } catch { /* already gone */ }
    }, 5000)
  }
}

/** Stops a managed ComfyUI instance, killing the entire process tree. */
export function stopInstance(instanceId: string): void {
  const proc = comfyProcesses.get(instanceId)
  if (proc && !proc.killed && proc.pid) {
    killProcessTree(proc.pid)
    comfyProcesses.delete(instanceId)
  } else {
    // Try via PID file (hot-reload case)
    const pid = readPid(instanceId)
    if (pid && isProcessAlive(pid)) {
      killProcessTree(pid)
    }
  }
  removePid(instanceId)
}

/** Stops then immediately restarts an instance. */
export async function restartInstance(instanceId: string): Promise<{ port: number; pid: number }> {
  stopInstance(instanceId)
  // Wait for the port to be released (up to 10 seconds)
  const instances = getComfyInstances()
  const instance = instances.find((i) => i.id === instanceId)
  if (instance) {
    const port = instance.port
    for (let i = 0; i < 20; i++) {
      const inUse = await new Promise<boolean>((resolve) => {
        const tester = createServer()
        tester.once('error', () => resolve(true))
        tester.once('listening', () => tester.close(() => resolve(false)))
        tester.listen(port, '127.0.0.1')
      })
      if (!inUse) break
      await new Promise((r) => setTimeout(r, 500))
    }
  }
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
          killProcessTree(pid)
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
