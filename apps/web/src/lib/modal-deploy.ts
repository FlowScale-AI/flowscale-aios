/**
 * Modal deployment manager.
 *
 * Handles deploy/undeploy/status for API-engine tool plugins on Modal.
 * Calls modal-helper.py via child_process for SDK operations.
 * Persists deployment state in ~/.flowscale/aios/modal-deployments.json.
 */

import { spawn } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { VALID_GPU_TIERS, type GpuTier } from './toolPlugins'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModalDeployment {
  status: 'deploying' | 'deployed'
  appName: string
  url: string
  gpu: string
  deployedAt: number
}

export interface ModalDeployStatus {
  status: 'not_deployed' | 'deploying' | 'deployed'
  warm: boolean
  gpu: string | null
  url: string | null
}

type DeploymentsFile = Record<string, ModalDeployment>

// ── Paths ────────────────────────────────────────────────────────────────────

const AIOS_DIR = join(homedir(), '.flowscale', 'aios')
const DEPLOYMENTS_FILE = join(AIOS_DIR, 'modal-deployments.json')
const PLUGINS_DIR = join(homedir(), '.flowscale', 'tool-plugins')
// In dev, process.cwd() is the apps/web dir. In production standalone,
// the script must be copied to the standalone output (see next.config.ts note below).
const HELPER_SCRIPT = join(process.cwd(), 'scripts', 'modal-helper.py')

// ── Concurrent deploy guard ─────────────────────────────────────────────────

const _deployingPlugins = new Set<string>()

export function isDeploying(pluginId: string): boolean {
  if (_deployingPlugins.has(pluginId)) return true
  const record = readDeployments()[pluginId]
  return record?.status === 'deploying'
}

// ── Persistence ──────────────────────────────────────────────────────────────

function readDeployments(): DeploymentsFile {
  try {
    return JSON.parse(readFileSync(DEPLOYMENTS_FILE, 'utf-8')) as DeploymentsFile
  } catch {
    return {}
  }
}

function writeDeployments(data: DeploymentsFile): void {
  mkdirSync(AIOS_DIR, { recursive: true })
  writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

function setDeployment(pluginId: string, deployment: ModalDeployment | null): void {
  const data = readDeployments()
  if (deployment) {
    data[pluginId] = deployment
  } else {
    delete data[pluginId]
  }
  writeDeployments(data)
}

// ── Helper script runner ─────────────────────────────────────────────────────

function runHelper(args: string[]): Promise<{ success: boolean; [key: string]: unknown }> {
  return new Promise((resolve) => {
    const proc = spawn('python3', [HELPER_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 660_000, // 11 min (deploy can take 10)
    })

    let stdout = ''
    let stderr = ''
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('error', (err) => {
      resolve({ success: false, error: err.message })
    })

    proc.on('close', (code) => {
      try {
        const parsed = JSON.parse(stdout.trim())
        resolve(parsed)
      } catch {
        resolve({ success: false, error: stderr || `Helper exited with code ${code}`, stdout })
      }
    })
  })
}

// ── Public API ───────────────────────────────────────────────────────────────

export function validateGpuTier(gpu: string): gpu is GpuTier {
  return (VALID_GPU_TIERS as readonly string[]).includes(gpu)
}

export async function deployToModal(
  pluginId: string,
  gpu: string,
): Promise<{ success: boolean; appName?: string; url?: string; error?: string }> {
  if (!validateGpuTier(gpu)) {
    return { success: false, error: `Invalid GPU tier: ${gpu}. Valid: ${VALID_GPU_TIERS.join(', ')}` }
  }

  const pluginDir = join(PLUGINS_DIR, pluginId)
  const modalAppPath = join(pluginDir, 'modal_app.py')

  if (!existsSync(modalAppPath)) {
    return { success: false, error: `modal_app.py not found in plugin directory: ${pluginDir}` }
  }

  // Mark as deploying
  _deployingPlugins.add(pluginId)
  setDeployment(pluginId, {
    status: 'deploying',
    appName: `flowscale-${pluginId}`,
    url: '',
    gpu,
    deployedAt: Date.now(),
  })

  try {
    const result = await runHelper(['deploy', pluginDir, gpu])

    if (result.success) {
      setDeployment(pluginId, {
        status: 'deployed',
        appName: result.appName as string,
        url: result.url as string,
        gpu,
        deployedAt: Date.now(),
      })
      return { success: true, appName: result.appName as string, url: result.url as string }
    } else {
      // Deploy failed — remove the deploying record
      setDeployment(pluginId, null)
      return { success: false, error: result.error as string }
    }
  } finally {
    _deployingPlugins.delete(pluginId)
  }
}

export async function undeployFromModal(
  pluginId: string,
): Promise<{ success: boolean; error?: string }> {
  const deployments = readDeployments()
  const record = deployments[pluginId]
  if (!record) return { success: true } // Already not deployed

  const result = await runHelper(['undeploy', record.appName])
  setDeployment(pluginId, null)
  return { success: true }
}

export async function getModalDeployStatus(pluginId: string): Promise<ModalDeployStatus> {
  const record = readDeployments()[pluginId]

  if (!record) {
    return { status: 'not_deployed', warm: false, gpu: null, url: null }
  }

  if (record.status === 'deploying') {
    return { status: 'deploying', warm: false, gpu: record.gpu, url: null }
  }

  // Check live status from Modal
  const result = await runHelper(['status', record.appName, record.url])

  if (!result.deployed) {
    // App no longer exists on Modal — clean up local record
    setDeployment(pluginId, null)
    return { status: 'not_deployed', warm: false, gpu: null, url: null }
  }

  return {
    status: 'deployed',
    warm: result.warm as boolean,
    gpu: (result.gpu as string) ?? record.gpu,
    url: record.url,
  }
}

/** Get the stored Modal endpoint URL for a plugin (fast, no SDK call). */
export function getModalUrl(pluginId: string): string | null {
  const record = readDeployments()[pluginId]
  return record?.status === 'deployed' ? record.url : null
}

/** Read deploy logs from disk (fast, no subprocess). */
export function getModalDeployLogs(pluginId: string): string {
  const logPath = join(PLUGINS_DIR, pluginId, 'modal-latest.log')
  try {
    return readFileSync(logPath, 'utf-8')
  } catch {
    return ''
  }
}

/** Fetch combined deploy + runtime logs via helper (spawns subprocess, ~3s). */
export async function getModalLogs(pluginId: string): Promise<string> {
  const record = readDeployments()[pluginId]
  const pluginDir = join(PLUGINS_DIR, pluginId)
  const appName = record?.appName ?? ''
  const result = await runHelper(['logs', pluginDir, appName])
  return (result.logs as string) ?? ''
}
