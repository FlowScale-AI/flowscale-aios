import { type ChildProcess, spawn, execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync, mkdirSync, openSync, closeSync } from 'fs'
import { join, dirname } from 'path'
import { homedir } from 'os'

function resolveScriptPath(): string {
  const scriptName = join('scripts', 'z_image_turbo_server.py')

  // 1. Electron's process.resourcesPath (set when running inside Electron binary)
  if (process.resourcesPath) {
    const p = join(process.resourcesPath, scriptName)
    if (existsSync(p)) return p
  }

  // 2. Standalone server: derive Resources dir from the server.js path.
  //    server.js lives at: .app/Contents/Resources/apps/web/.next/standalone/apps/web/server.js
  //    scripts live at:    .app/Contents/Resources/scripts/z_image_turbo_server.py
  if (process.argv[1]) {
    const serverDir = dirname(process.argv[1])
    // Walk up from apps/web/ to the standalone root, then up to Resources
    const resourcesDir = join(serverDir, '..', '..', '..', '..', '..', '..')
    const p = join(resourcesDir, scriptName)
    if (existsSync(p)) return p
  }

  // 3. Dev fallback: repo root relative to apps/web/
  return join(process.cwd(), '../../scripts/z_image_turbo_server.py')
}

function killPort(port: number): void {
  // Kill only processes LISTENING on this port — never connections in TIME_WAIT
  // or ESTABLISHED, which could match the Node.js server itself (if it recently
  // made a health-check fetch to this port).
  try {
    if (process.platform === 'darwin') {
      const pids = execSync(`lsof -ti TCP:${port} -sTCP:LISTEN`, { encoding: 'utf-8' }).trim()
      if (pids) execSync(`kill -9 ${pids.split('\n').join(' ')}`, { stdio: 'ignore' })
    } else {
      execSync(`fuser -k ${port}/tcp`, { stdio: 'ignore' })
    }
  } catch { /* nothing on port */ }
}

export const LOCAL_INFERENCE_PORT = 8765
const INFERENCE_DIR = join(homedir(), '.flowscale', 'aios')
const PID_FILE = join(INFERENCE_DIR, 'inference-server.pid')
const LOG_FILE = join(INFERENCE_DIR, 'inference-server.log')
const MAX_LOG_LINES = 300

// Ensure the directory exists on module load
try { mkdirSync(INFERENCE_DIR, { recursive: true }) } catch { /* ignore */ }

export function getServerLogs(): string[] {
  try {
    const raw = readFileSync(LOG_FILE, 'utf-8')
    // Python writes directly to the log file — collapse \r-separated progress
    // lines so only the latest progress bar is shown.
    const segments = raw.split(/\r|\n/).filter(Boolean)
    const lines: string[] = []
    for (const seg of segments) {
      const line = seg.trim()
      if (!line) continue
      const last = lines[lines.length - 1] ?? ''
      if (last.includes('%|') && line.includes('%|')) {
        lines[lines.length - 1] = line // keep latest progress bar only
      } else {
        lines.push(line)
      }
    }
    // Return only the last MAX_LOG_LINES
    return lines.slice(-MAX_LOG_LINES)
  } catch { return [] }
}

export function clearServerLogs() {
  try { writeFileSync(LOG_FILE, '', 'utf-8') } catch { /* ignore */ }
}

function writePid(pid: number) {
  try { writeFileSync(PID_FILE, String(pid), 'utf-8') } catch { /* ignore */ }
}

function clearPid() {
  try { if (existsSync(PID_FILE)) unlinkSync(PID_FILE) } catch { /* ignore */ }
}

function storedPid(): number | null {
  try { return parseInt(readFileSync(PID_FILE, 'utf-8').trim(), 10) || null } catch { return null }
}

function isAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

/** Check if a PID is actually a Python process (our inference server), not a recycled PID. */
function isPythonProcess(pid: number): boolean {
  try {
    const cmd = execSync(
      process.platform === 'darwin'
        ? `ps -p ${pid} -o command=`
        : `ps -p ${pid} -o cmd=`,
      { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
    ).trim()
    return cmd.includes('python') || cmd.includes('z_image_turbo_server')
  } catch {
    return false
  }
}

export async function isServerRunning(): Promise<boolean> {
  try {
    const res = await fetch(`http://127.0.0.1:${LOCAL_INFERENCE_PORT}/health`, {
      signal: AbortSignal.timeout(6000), // generous — CPU inference holds the GIL briefly
    })
    return res.ok
  } catch {
    return false
  }
}

/** Check if the Python process is alive (PID file + process check). */
export function isProcessAlive(): boolean {
  const pid = storedPid()
  if (!pid) return false
  return isAlive(pid) && isPythonProcess(pid)
}

export type ServerStatus = 'running' | 'starting' | 'stopped'

/**
 * Returns granular server status:
 * - `running`: health check passes (model loaded, ready)
 * - `starting`: process alive but health check fails (downloading/loading)
 * - `stopped`: no process alive
 */
export async function getServerStatus(): Promise<ServerStatus> {
  const healthy = await isServerRunning()
  if (healthy) return 'running'
  if (isProcessAlive()) return 'starting'
  return 'stopped'
}

function detectGpuType(): 'rocm' | 'cuda' | 'cpu' {
  try { execSync('nvidia-smi', { stdio: 'ignore' }); return 'cuda' } catch { /* no nvidia */ }
  try { if (existsSync('/dev/kfd')) return 'rocm' } catch { /* ignore */ }
  return 'cpu'
}

const REQUIRED_PACKAGES = ['diffusers', 'transformers', 'accelerate', 'fastapi', 'uvicorn', 'PIL', 'torchvision']

export function areDepsInstalled(python: string): boolean {
  try {
    const checks = REQUIRED_PACKAGES.map((pkg) => `import ${pkg}`).join('; ')
    execSync(`${python} -c "${checks}"`, { stdio: 'ignore' })
    // Check torch is installed AND matches the available GPU type
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
  // Prefer Homebrew Python — macOS system Python (3.9 + LibreSSL) can't download
  // large files from HuggingFace due to SSL incompatibility.
  for (const bin of ['/opt/homebrew/bin/python3', '/usr/local/bin/python3', 'python3', 'python']) {
    try { execSync(`${bin} --version`, { stdio: 'ignore' }); return bin } catch { /* try next */ }
  }
  throw new Error('Python not found. Install Python 3.8+ and try again.')
}

/** Returns a spawned pip install process — caller streams stdout/stderr */
export function spawnInstall(python: string): ChildProcess {
  const others = 'diffusers transformers accelerate fastapi uvicorn pillow'
  const gpu = detectGpuType()
  const torchIndex =
    gpu === 'rocm' ? 'https://download.pytorch.org/whl/rocm6.3' :
    gpu === 'cuda' ? 'https://download.pytorch.org/whl/cu124' :
    'https://download.pytorch.org/whl/cpu'
  // --break-system-packages needed for Homebrew Python 3.12+ (PEP 668)
  const pipFlags = '--break-system-packages'
  const cmd = [
    `${python} -m pip install ${pipFlags} --force-reinstall torch torchvision --index-url ${torchIndex}`,
    `${python} -m pip install ${pipFlags} --upgrade ${others}`,
  ].join(' && ')
  return spawn('sh', ['-c', cmd], { stdio: 'pipe' })
}

/**
 * Spawn the inference server as a fully detached background process.
 * It writes stdout/stderr directly to the log file so it survives
 * independently of the Node.js server lifecycle (page navigations,
 * server restarts, etc.). The caller should poll isServerRunning()
 * to detect readiness.
 */
export function spawnServer(python: string): void {
  // Kill stale process if alive — but ONLY if it's actually a Python process.
  // PIDs get recycled by the OS; a stale PID file could point to the Node.js
  // standalone server itself, and killing it would crash the app.
  const pid = storedPid()
  if (pid && isAlive(pid)) {
    if (isPythonProcess(pid)) {
      try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
    }
    clearPid()
  }
  // Force-free the port in case a zombie thread pool is still holding it
  killPort(LOCAL_INFERENCE_PORT)

  const scriptPath = resolveScriptPath()
  clearServerLogs()

  // Open the log file for direct writing — the detached process writes here
  // instead of via pipes, so it survives even if the Node.js server restarts.
  const logFd = openSync(LOG_FILE, 'w')

  const proc = spawn(python, ['-u', scriptPath, '--port', String(LOCAL_INFERENCE_PORT)], {
    stdio: ['ignore', logFd, logFd],
    detached: true,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

  if (!proc.pid) {
    closeSync(logFd)
    throw new Error('Failed to spawn inference server')
  }

  writePid(proc.pid)
  closeSync(logFd)

  // Detach: let the Python process run independently of this Node.js process
  proc.unref()
}

export function stopServer(): boolean {
  let stopped = false
  const pid = storedPid()
  if (pid && isAlive(pid) && isPythonProcess(pid)) {
    try { process.kill(pid, 'SIGKILL'); stopped = true } catch { /* ignore */ }
  }
  clearPid()
  // Also kill anything still occupying the port (e.g. a thread-pool zombie)
  killPort(LOCAL_INFERENCE_PORT)
  return stopped
}
