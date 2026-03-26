/**
 * Modal CLI wrapper for install, auth, and status management.
 *
 * Follows the same patterns as comfyui-manager.ts — uses child_process
 * for CLI interaction and PID/toml files for persistent state.
 */

import { execSync, spawn, type ChildProcess } from 'child_process'
import { existsSync, unlinkSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

let authProcess: ChildProcess | null = null

function getModalTomlPath(): string {
  return join(homedir(), '.modal.toml')
}

/**
 * Resolve the full path to the `modal` binary.
 * pip installs to user-local bin dirs that may not be in the Next.js server PATH,
 * so we check common locations explicitly.
 */
function findModalBin(): string {
  // 1. Check if `modal` is already on PATH
  try {
    const which = execSync('which modal', { timeout: 5000, stdio: 'pipe' }).toString().trim()
    if (which) return which
  } catch {}

  // 2. Check common pip user-install locations
  const home = homedir()
  const candidates = [
    join(home, 'Library', 'Python', '3.9', 'bin', 'modal'),  // macOS pip3 --user
    join(home, 'Library', 'Python', '3.10', 'bin', 'modal'),
    join(home, 'Library', 'Python', '3.11', 'bin', 'modal'),
    join(home, 'Library', 'Python', '3.12', 'bin', 'modal'),
    join(home, 'Library', 'Python', '3.13', 'bin', 'modal'),
    join(home, '.local', 'bin', 'modal'),                     // Linux pip --user
    '/usr/local/bin/modal',
    '/opt/homebrew/bin/modal',
  ]
  for (const p of candidates) {
    if (existsSync(p)) return p
  }

  return 'modal' // fallback — hope it's on PATH
}

/** Cached modal binary path. */
let _modalBin: string | null = null
export function modalBin(): string {
  if (!_modalBin) _modalBin = findModalBin()
  return _modalBin
}

function findPipExec(): string {
  // Try pip3, pip, python -m pip, python3 -m pip
  for (const cmd of ['pip3 --version', 'pip --version']) {
    try {
      execSync(cmd, { timeout: 5000, stdio: 'pipe' })
      return cmd.split(' ')[0]
    } catch {}
  }
  return 'pip'
}

export function isModalInstalled(): boolean {
  try {
    execSync(`${modalBin()} --version`, { timeout: 10000, stdio: 'pipe' })
    return true
  } catch {
    return false
  }
}

export async function installModal(): Promise<{ success: boolean; error?: string; logs?: string }> {
  return new Promise((resolve) => {
    const pip = findPipExec()
    const proc = spawn(pip, ['install', 'modal'], {
      stdio: 'pipe',
      shell: true,
    })
    let stdout = ''
    let stderr = ''
    proc.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    proc.on('error', (err) => resolve({ success: false, error: err.message }))
    proc.on('close', (code) => {
      if (code === 0) {
        resolve({ success: true, logs: stdout })
      } else {
        resolve({ success: false, error: stderr || `pip exited with code ${code}`, logs: stdout })
      }
    })
  })
}

export function getModalStatus(): { installed: boolean; authenticated: boolean; workspace?: string } {
  const installed = isModalInstalled()
  if (!installed) return { installed: false, authenticated: false }

  const tomlExists = existsSync(getModalTomlPath())
  if (!tomlExists) return { installed: true, authenticated: false }

  // Try to get workspace info
  try {
    const output = execSync(`${modalBin()} profile current`, { timeout: 10000, stdio: 'pipe' }).toString().trim()
    // modal profile current outputs the workspace name
    if (output) {
      return { installed: true, authenticated: true, workspace: output }
    }
  } catch {
    // Token exists but may be invalid — fall back to checking file existence
    return { installed: true, authenticated: true, workspace: 'default' }
  }

  return { installed: true, authenticated: tomlExists }
}

/** Pending auth URL extracted from `modal token new` output. */
let pendingAuthUrl: string | null = null

export function startModalAuth(): { started: boolean; error?: string; url?: string | null } {
  if (authProcess && !authProcess.killed) {
    return { started: true, url: pendingAuthUrl }
  }

  pendingAuthUrl = null

  try {
    authProcess = spawn(modalBin(), ['token', 'new', '--no-verify'], {
      stdio: 'pipe',
      shell: false,
      detached: false,
      env: { ...process.env, BROWSER: 'echo' }, // prevent modal from opening a browser itself
    })

    const extractUrl = (chunk: Buffer) => {
      const text = chunk.toString()
      // modal token new outputs a URL like https://modal.com/token-flow/...
      const match = text.match(/(https:\/\/modal\.com\/\S+)/)
      if (match) {
        pendingAuthUrl = match[1]
      }
    }

    authProcess.stdout?.on('data', extractUrl)
    authProcess.stderr?.on('data', extractUrl)

    authProcess.on('error', (err) => {
      console.error('Modal auth error:', err.message)
      authProcess = null
      pendingAuthUrl = null
    })

    authProcess.on('close', () => {
      authProcess = null
      // Keep pendingAuthUrl alive for 60s after process exits so the frontend can still retrieve it
      setTimeout(() => { pendingAuthUrl = null }, 60_000)
    })

    return { started: true }
  } catch (err: unknown) {
    return { started: false, error: err instanceof Error ? err.message : String(err) }
  }
}

/** Returns the auth URL if one has been captured from the modal token flow. */
export function getModalAuthUrl(): string | null {
  return pendingAuthUrl
}

export function isAuthInProgress(): boolean {
  return authProcess != null && !authProcess.killed
}

/**
 * Sync a HuggingFace token to Modal as a secret named "huggingface-secret".
 * Called automatically when the user saves their HF key in Settings > Providers.
 */
export function syncHfTokenToModal(token: string): { success: boolean; error?: string } {
  if (!isModalInstalled()) return { success: false, error: 'Modal CLI not installed' }

  try {
    // Check if secret already exists
    const bin = modalBin()
    const listResult = execSync(`${bin} secret list`, { timeout: 10000, stdio: 'pipe' }).toString()
    const secretExists = listResult.includes('huggingface-secret')

    if (secretExists) {
      // Delete and recreate (Modal doesn't have an update command)
      execSync(`${bin} secret delete huggingface-secret --yes`, { timeout: 10000, stdio: 'pipe' })
    }

    // Create the secret
    execSync(`${bin} secret create huggingface-secret HF_TOKEN=${token}`, {
      timeout: 10000,
      stdio: 'pipe',
    })

    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function disconnectModal(): { success: boolean; error?: string } {
  try {
    const tomlPath = getModalTomlPath()
    if (existsSync(tomlPath)) {
      unlinkSync(tomlPath)
    }
    return { success: true }
  } catch (err: unknown) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
}
