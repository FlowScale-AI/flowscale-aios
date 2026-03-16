import { type ChildProcess, spawn, execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, openSync, closeSync } from 'fs'
import { join, resolve, normalize } from 'path'
import { homedir } from 'os'
import { getPlugin, getPluginDir } from './toolPlugins'

const DEFAULT_PLUGIN_ID = 'z-image-turbo'

function getLocalPlugin(pluginId: string) {
  const plugin = getPlugin(pluginId)
  if (!plugin) throw new Error(`Plugin "${pluginId}" not found`)
  return plugin
}

function resolvePluginScriptPath(pluginId: string): string {
  const plugin = getLocalPlugin(pluginId)
  const dir = getPluginDir(pluginId)
  const scriptPath = resolve(dir, normalize(plugin.server.script))
  // Ensure the resolved path stays within the plugin directory
  if (!scriptPath.startsWith(dir + '/') && scriptPath !== dir) {
    throw new Error(`Plugin "${pluginId}" script path escapes plugin directory`)
  }
  if (!existsSync(scriptPath)) {
    throw new Error(`Plugin "${pluginId}" server script not found at ${scriptPath}`)
  }
  return scriptPath
}

function getPluginPort(pluginId: string): number {
  return getLocalPlugin(pluginId).server.port
}

function getPluginHealthEndpoint(pluginId: string): string {
  const plugin = getPlugin(pluginId)
  return plugin?.server.healthEndpoint ?? '/health'
}

function killPort(port: number): void {
  try {
    if (process.platform === 'darwin') {
      const pids = execSync(`lsof -ti TCP:${port} -sTCP:LISTEN`, { encoding: 'utf-8' }).trim()
      if (pids) execSync(`kill -9 ${pids.split('\n').join(' ')}`, { stdio: 'ignore' })
    } else {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' })
    }
  } catch { /* nothing on port */ }
}

const INFERENCE_DIR = join(homedir(), '.flowscale', 'aios')
const MAX_LOG_LINES = 300

// Ensure the directory exists on module load
try { mkdirSync(INFERENCE_DIR, { recursive: true }) } catch { /* ignore */ }

// ── Per-plugin PID and log file paths ────────────────────────────────────────

function pidFile(pluginId: string): string {
  return join(INFERENCE_DIR, `plugin-${pluginId}.pid`)
}

function logFile(pluginId: string): string {
  return join(INFERENCE_DIR, `plugin-${pluginId}.log`)
}

// ── Log management ───────────────────────────────────────────────────────────

export function getServerLogs(pluginId: string = DEFAULT_PLUGIN_ID): string[] {
  try {
    const raw = readFileSync(logFile(pluginId), 'utf-8')
    const segments = raw.split(/\r|\n/).filter(Boolean)
    const lines: string[] = []
    for (const seg of segments) {
      const line = seg.trim()
      if (!line) continue
      if (line.includes('/health') && line.includes('200')) continue
      const last = lines[lines.length - 1] ?? ''
      if (last.includes('%|') && line.includes('%|')) {
        lines[lines.length - 1] = line
      } else {
        lines.push(line)
      }
    }
    return lines.slice(-MAX_LOG_LINES)
  } catch { return [] }
}

export function clearServerLogs(pluginId: string = DEFAULT_PLUGIN_ID) {
  try { writeFileSync(logFile(pluginId), '', 'utf-8') } catch { /* ignore */ }
}

// ── PID management ───────────────────────────────────────────────────────────

function writePid(pluginId: string, pid: number) {
  try { writeFileSync(pidFile(pluginId), String(pid), 'utf-8') } catch { /* ignore */ }
}

function clearPid(pluginId: string) {
  try { if (existsSync(pidFile(pluginId))) unlinkSync(pidFile(pluginId)) } catch { /* ignore */ }
}

function storedPid(pluginId: string): number | null {
  try { return parseInt(readFileSync(pidFile(pluginId), 'utf-8').trim(), 10) || null } catch { return null }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

function isPythonProcess(pid: number): boolean {
  try {
    const cmd = execSync(
      process.platform === 'darwin'
        ? `ps -p ${pid} -o command=`
        : `ps -p ${pid} -o cmd=`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim()
    return cmd.includes('python') || cmd.includes('server')
  } catch {
    return false
  }
}

// ── Server status ────────────────────────────────────────────────────────────

export async function isServerRunning(pluginId: string = DEFAULT_PLUGIN_ID): Promise<boolean> {
  try {
    const port = getPluginPort(pluginId)
    const healthEndpoint = getPluginHealthEndpoint(pluginId)
    const res = await fetch(`http://127.0.0.1:${port}${healthEndpoint}`, {
      signal: AbortSignal.timeout(6000),
    })
    return res.ok
  } catch {
    return false
  }
}

export function isProcessAlive(pluginId: string = DEFAULT_PLUGIN_ID): boolean {
  const pid = storedPid(pluginId)
  if (!pid) return false
  return isAlive(pid) && isPythonProcess(pid)
}

export type ServerStatus = 'running' | 'starting' | 'stopped'

export async function getServerStatus(pluginId: string = DEFAULT_PLUGIN_ID): Promise<ServerStatus> {
  const plugin = getPlugin(pluginId)
  if (!plugin) return 'stopped'

  const healthy = await isServerRunning(pluginId)
  if (healthy) return 'running'
  if (isProcessAlive(pluginId)) return 'starting'
  return 'stopped'
}

// ── GPU / dependencies ───────────────────────────────────────────────────────

function detectGpuType(): 'rocm' | 'cuda' | 'cpu' {
  try { execSync('nvidia-smi', { stdio: 'ignore' }); return 'cuda' } catch { /* no nvidia */ }
  try { if (existsSync('/dev/kfd')) return 'rocm' } catch { /* ignore */ }
  return 'cpu'
}

export function areDepsInstalled(python: string, pluginId: string = DEFAULT_PLUGIN_ID): boolean {
  const plugin = getPlugin(pluginId)
  if (!plugin) return false
  const packages = plugin.dependencies?.packages ?? []

  try {
    const checks = packages.map((pkg) => `import ${pkg}`).join('; ')
    execSync(`${python} -c "${checks}"`, { stdio: 'ignore' })
    const gpu = detectGpuType()
    if (gpu === 'rocm') {
      execSync(`${python} -c "import torch; assert torch.version.hip is not None, 'not rocm'"`, { stdio: 'ignore' })
    } else if (gpu === 'cuda') {
      execSync(`${python} -c "import torch; assert '+cu' in torch.__version__, 'not cuda'"`, { stdio: 'ignore' })
    } else {
      execSync(`${python} -c "import torch"`, { stdio: 'ignore' })
    }
    return true
  } catch {
    return false
  }
}

export function resolvePython(): string {
  for (const bin of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3', 'python']) {
    try { execSync(`${bin} --version`, { stdio: 'ignore' }); return bin } catch { /* try next */ }
  }
  throw new Error('Python not found. Install Python 3.8+ and try again.')
}

/** Returns a spawned pip install process — caller streams stdout/stderr */
export function spawnInstall(python: string, pluginId: string = DEFAULT_PLUGIN_ID): ChildProcess {
  const plugin = getPlugin(pluginId)
  const packages = plugin?.dependencies?.packages ?? []
  // Map import names to pip package names
  const pipNames = packages.map((p) => p === 'PIL' ? 'pillow' : p)
  const others = pipNames.join(' ')

  const gpu = detectGpuType()
  const torchIndex =
    gpu === 'rocm' ? 'https://download.pytorch.org/whl/rocm6.3' :
    gpu === 'cuda' ? 'https://download.pytorch.org/whl/cu124' :
    'https://download.pytorch.org/whl/cpu'
  const pipFlags = '--break-system-packages'
  const cmd = [
    `${python} -m pip install ${pipFlags} --force-reinstall torch torchvision --index-url ${torchIndex}`,
    `${python} -m pip install ${pipFlags} --upgrade ${others}`,
  ].join(' && ')
  return spawn('sh', ['-c', cmd], { stdio: 'pipe' })
}

// ── Server lifecycle ─────────────────────────────────────────────────────────

export function spawnServer(python: string, pluginId: string = DEFAULT_PLUGIN_ID): void {
  const port = getPluginPort(pluginId)

  const pid = storedPid(pluginId)
  if (pid && isAlive(pid)) {
    if (isPythonProcess(pid)) {
      try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
    }
    clearPid(pluginId)
  }
  killPort(port)

  const scriptPath = resolvePluginScriptPath(pluginId)
  clearServerLogs(pluginId)

  const logFd = openSync(logFile(pluginId), 'w')

  const proc = spawn(python, ['-u', scriptPath, '--port', String(port)], {
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

  if (!proc.pid) {
    closeSync(logFd)
    throw new Error('Failed to spawn inference server')
  }

  writePid(pluginId, proc.pid)
  closeSync(logFd)

  proc.unref()
}

export function stopServer(pluginId: string = DEFAULT_PLUGIN_ID): boolean {
  const port = getPluginPort(pluginId)
  let stopped = false
  const pid = storedPid(pluginId)
  if (pid && isAlive(pid) && isPythonProcess(pid)) {
    try { process.kill(pid, 'SIGKILL'); stopped = true } catch { /* ignore */ }
  }
  clearPid(pluginId)
  killPort(port)
  return stopped
}
