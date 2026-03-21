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
    execSync('modal --version', { timeout: 10000, stdio: 'pipe' })
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
    const output = execSync('modal profile current', { timeout: 10000, stdio: 'pipe' }).toString().trim()
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

export function startModalAuth(): { started: boolean; error?: string } {
  if (authProcess && !authProcess.killed) {
    return { started: true } // Already running
  }

  try {
    authProcess = spawn('modal', ['token', 'new'], {
      stdio: 'pipe',
      shell: true,
      detached: false,
    })

    authProcess.on('error', (err) => {
      console.error('Modal auth error:', err.message)
      authProcess = null
    })

    authProcess.on('close', () => {
      authProcess = null
    })

    return { started: true }
  } catch (err: unknown) {
    return { started: false, error: err instanceof Error ? err.message : String(err) }
  }
}

export function isAuthInProgress(): boolean {
  return authProcess != null && !authProcess.killed
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
