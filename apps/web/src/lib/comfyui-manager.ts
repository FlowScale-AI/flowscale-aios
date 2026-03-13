/**
 * ComfyUI process lifecycle manager.
 *
 * Only ONE ComfyUI instance is ever managed by AIOS.  All state is persisted
 * to a PID file so it survives Next.js hot-reloads in dev mode.
 */

import { spawn, type ChildProcess } from 'child_process'
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync } from 'fs'
import path from 'path'
import os from 'os'
import { getComfyManagedPath, getComfyManagedPort } from './providerSettings'

const PID_FILE = path.join(os.homedir(), '.flowscale', 'aios', 'comfyui.pid')

// In-process reference — survives route re-use within one Node process, but
// will be null after a hot-reload.  PID file is the persistent source of truth.
let comfyProcess: ChildProcess | null = null

export type ComfyStatus = 'running' | 'starting' | 'stopping' | 'stopped'

export interface ComfyStatusResult {
  status: ComfyStatus
  pid?: number
  port: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function writePid(pid: number): void {
  mkdirSync(path.dirname(PID_FILE), { recursive: true })
  writeFileSync(PID_FILE, String(pid), 'utf-8')
}

function readPid(): number | null {
  try {
    const raw = readFileSync(PID_FILE, 'utf-8').trim()
    const pid = parseInt(raw, 10)
    return isNaN(pid) ? null : pid
  } catch {
    return null
  }
}

function removePid(): void {
  try { unlinkSync(PID_FILE) } catch { /* ignore */ }
}

function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

/** Returns the best Python executable for the given ComfyUI installation. */
function findPythonExec(comfyPath: string): string {
  const isWin = process.platform === 'win32'

  // Standard venv inside the ComfyUI directory
  const candidates = isWin
    ? [
        path.join(comfyPath, 'venv', 'Scripts', 'python.exe'),
      ]
    : [
        path.join(comfyPath, 'venv', 'bin', 'python3'),
        path.join(comfyPath, 'venv', 'bin', 'python'),
        // macOS Desktop App bundles Python in the .app Resources sibling dirs:
        // /Applications/ComfyUI.app/Contents/Resources/ComfyUI → ../python_embeds/bin/python3
        path.join(comfyPath, '..', 'python_embeds', 'bin', 'python3'),
        path.join(comfyPath, '..', 'venv', 'bin', 'python3'),
        path.join(comfyPath, '..', 'venv', 'bin', 'python'),
      ]

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate
  }

  return isWin ? 'python' : 'python3'
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns the current status based on the PID file.
 * Does NOT do an HTTP probe — the API route handles that.
 */
export function getProcessStatus(): { alive: boolean; pid: number | null; port: number } {
  const port = getComfyManagedPort()

  // Prefer the live process reference first
  if (comfyProcess && !comfyProcess.killed && comfyProcess.pid) {
    const alive = isProcessAlive(comfyProcess.pid)
    if (!alive) { comfyProcess = null; removePid() }
    return { alive, pid: comfyProcess?.pid ?? null, port }
  }

  // Fall back to PID file
  const pid = readPid()
  if (!pid) return { alive: false, pid: null, port }

  if (isProcessAlive(pid)) return { alive: true, pid, port }

  // Stale PID — clean up
  removePid()
  return { alive: false, pid: null, port }
}

/**
 * Starts ComfyUI.  Returns immediately after spawning.
 * Throws if configuration is missing or the binary can't be found.
 */
export function startComfyUI(): { port: number; pid: number } {
  const comfyPath = getComfyManagedPath()
  if (!comfyPath) throw new Error('ComfyUI path not configured. Please complete the setup first.')
  if (!existsSync(comfyPath)) throw new Error(`ComfyUI directory not found: ${comfyPath}`)

  const mainPy = path.join(comfyPath, 'main.py')
  if (!existsSync(mainPy)) {
    throw new Error(`ComfyUI main.py not found at: ${mainPy}. Is this a valid ComfyUI installation?`)
  }

  const port = getComfyManagedPort()
  const python = findPythonExec(comfyPath)

  const child = spawn(
    python,
    [mainPy, '--port', String(port), '--listen', '127.0.0.1'],
    {
      cwd: comfyPath,
      detached: false,
      stdio: 'pipe',
      env: { ...process.env },
    },
  )

  comfyProcess = child

  if (child.pid) {
    writePid(child.pid)
  }

  child.stdout?.on('data', () => { /* consumed to avoid back-pressure */ })
  child.stderr?.on('data', () => { /* consumed to avoid back-pressure */ })

  child.on('exit', () => {
    comfyProcess = null
    removePid()
  })

  if (!child.pid) throw new Error('Failed to spawn ComfyUI process')

  return { port, pid: child.pid }
}

/** Sends SIGTERM to the managed ComfyUI process (SIGKILL after 5 s). */
export function stopComfyUI(): void {
  if (comfyProcess && !comfyProcess.killed) {
    const proc = comfyProcess
    proc.kill('SIGTERM')
    setTimeout(() => {
      if (!proc.killed) proc.kill('SIGKILL')
    }, 5000)
    comfyProcess = null
  } else {
    // Try via PID file (hot-reload case)
    const pid = readPid()
    if (pid && isProcessAlive(pid)) {
      try { process.kill(pid, 'SIGTERM') } catch { /* ignore */ }
      setTimeout(() => {
        if (isProcessAlive(pid)) {
          try { process.kill(pid, 'SIGKILL') } catch { /* ignore */ }
        }
      }, 5000)
    }
  }
  removePid()
}

/** Stops then immediately restarts ComfyUI. */
export function restartComfyUI(): { port: number; pid: number } {
  stopComfyUI()
  // Brief pause to let the port free up before binding again
  return startComfyUI()
}
