import { ChildProcess, spawn, execSync } from 'child_process'
import { writeFileSync, readFileSync, unlinkSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export const LOCAL_INFERENCE_PORT = 8765
const PID_FILE = join(homedir(), '.flowscale', 'aios', 'inference-server.pid')

// Module-level ref — survives across requests in the same process
let _proc: ChildProcess | null = null

const LOG_FILE = join(homedir(), '.flowscale', 'aios', 'inference-server.log')
const MAX_LOG_LINES = 300

function appendLog(chunk: Buffer) {
  // tqdm uses \r — split on both \r and \n, update progress lines in place
  const segments = chunk.toString().split(/\r|\n/)
  let lines: string[] = []
  try {
    const existing = readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean)
    lines = existing
  } catch { /* first write */ }

  for (const seg of segments) {
    const line = seg.trim()
    if (!line) continue
    const last = lines[lines.length - 1] ?? ''
    if (last.includes('%|') && line.includes('%|')) {
      lines[lines.length - 1] = line // update progress bar in place
    } else {
      lines.push(line)
    }
  }
  if (lines.length > MAX_LOG_LINES) lines.splice(0, lines.length - MAX_LOG_LINES)
  try { writeFileSync(LOG_FILE, lines.join('\n') + '\n', 'utf-8') } catch { /* ignore */ }
}

export function getServerLogs(): string[] {
  try { return readFileSync(LOG_FILE, 'utf-8').split('\n').filter(Boolean) } catch { return [] }
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
  for (const bin of ['python3', 'python']) {
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
  const cmd = [
    `${python} -m pip install --force-reinstall torch torchvision --index-url ${torchIndex}`,
    `${python} -m pip install --upgrade ${others}`,
  ].join(' && ')
  return spawn('sh', ['-c', cmd], { stdio: 'pipe' })
}

/**
 * Spawn the inference server in the background and return immediately.
 * The caller should poll isServerRunning() to detect readiness —
 * first run may take many minutes due to model download.
 */
export function spawnServer(python: string): void {
  // Kill stale process if alive
  const pid = storedPid()
  if (pid && isAlive(pid)) { try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ } clearPid() }
  if (_proc) { try { _proc.kill('SIGKILL') } catch { /* ignore */ } _proc = null }
  // Force-free the port in case a zombie thread pool is still holding it
  try { execSync(`fuser -k ${LOCAL_INFERENCE_PORT}/tcp`, { stdio: 'ignore' }) } catch { /* nothing on port */ }

  const scriptPath = join(process.cwd(), '../../scripts/z_image_turbo_server.py')
  const proc = spawn(python, ['-u', scriptPath, '--port', String(LOCAL_INFERENCE_PORT)], {
    stdio: 'pipe',
    detached: false,
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  })

  if (!proc.pid) throw new Error('Failed to spawn inference server')

  _proc = proc
  writePid(proc.pid)
  clearServerLogs()
  proc.stdout?.on('data', appendLog)
  proc.stderr?.on('data', appendLog)
  proc.on('exit', () => { _proc = null; clearPid() })
}

export function stopServer(): boolean {
  let stopped = false
  if (_proc) { try { _proc.kill('SIGKILL'); stopped = true } catch { /* ignore */ } _proc = null }
  const pid = storedPid()
  if (pid && isAlive(pid)) { try { process.kill(pid, 'SIGKILL'); stopped = true } catch { /* ignore */ } }
  clearPid()
  // Also kill anything still occupying the port (e.g. a thread-pool zombie)
  try { execSync(`fuser -k ${LOCAL_INFERENCE_PORT}/tcp`, { stdio: 'ignore' }) } catch { /* nothing on port */ }
  return stopped
}
