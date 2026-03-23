/**
 * Modal deployment manager.
 *
 * Handles deploy/undeploy/status for API-engine tool plugins on Modal.
 * Calls modal-helper.py via child_process for SDK operations.
 * Persists deployment state in ~/.flowscale/aios/modal-deployments.json.
 *
 * Supports multiple deployments per plugin (array-based storage).
 * Legacy single-object records are migrated to arrays on first read.
 */

import { spawn } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { VALID_GPU_TIERS, type GpuTier } from './toolPlugins'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModalDeploymentRecord {
  id: string
  name: string
  status: 'deploying' | 'deployed'
  appName: string
  url: string
  gpu: string
  deployedAt: number
}

type DeploymentsFile = Record<string, ModalDeploymentRecord[]>

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
  const records = readDeployments()[pluginId] ?? []
  return records.some((r) => r.status === 'deploying')
}

// ── Persistence ──────────────────────────────────────────────────────────────

/** Shape of a legacy (pre-array) deployment record stored on disk. */
interface _LegacyDeployment {
  status: 'deploying' | 'deployed'
  appName: string
  url: string
  gpu: string
  deployedAt: number
}

function _isLegacyRecord(value: unknown): value is _LegacyDeployment {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    'appName' in (value as object)
  )
}

function readDeployments(): DeploymentsFile {
  let raw: Record<string, unknown>
  try {
    raw = JSON.parse(readFileSync(DEPLOYMENTS_FILE, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }

  let needsWrite = false
  const result: DeploymentsFile = {}

  for (const [pluginId, entry] of Object.entries(raw)) {
    if (Array.isArray(entry)) {
      result[pluginId] = entry as ModalDeploymentRecord[]
    } else if (_isLegacyRecord(entry)) {
      // Migration: derive id/name from appName by stripping 'flowscale-' prefix
      const id = entry.appName.startsWith('flowscale-')
        ? entry.appName.slice('flowscale-'.length)
        : entry.appName
      const name = id
      result[pluginId] = [{ id, name, ...entry }]
      needsWrite = true
    }
  }

  if (needsWrite) {
    writeDeployments(result)
  }

  return result
}

function writeDeployments(data: DeploymentsFile): void {
  mkdirSync(AIOS_DIR, { recursive: true })
  writeFileSync(DEPLOYMENTS_FILE, JSON.stringify(data, null, 2), 'utf-8')
}

function addDeployment(pluginId: string, record: ModalDeploymentRecord): void {
  const data = readDeployments()
  const existing = data[pluginId] ?? []
  data[pluginId] = [...existing, record]
  writeDeployments(data)
}

function updateDeployment(
  pluginId: string,
  deployId: string,
  updates: Partial<ModalDeploymentRecord>,
): void {
  const data = readDeployments()
  const existing = data[pluginId] ?? []
  data[pluginId] = existing.map((r) => (r.id === deployId ? { ...r, ...updates } : r))
  writeDeployments(data)
}

function removeDeployment(pluginId: string, deployId: string): void {
  const data = readDeployments()
  const existing = data[pluginId] ?? []
  data[pluginId] = existing.filter((r) => r.id !== deployId)
  if (data[pluginId].length === 0) {
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
  deployId: string,
  name: string,
): Promise<{ success: boolean; appName?: string; url?: string; error?: string }> {
  if (!validateGpuTier(gpu)) {
    return { success: false, error: `Invalid GPU tier: ${gpu}. Valid: ${VALID_GPU_TIERS.join(', ')}` }
  }

  // Validate name uniqueness among existing deployments for this plugin
  const existingDeployments = readDeployments()[pluginId] ?? []
  if (existingDeployments.some((r) => r.name === name)) {
    return { success: false, error: `A deployment named "${name}" already exists for this plugin.` }
  }

  const pluginDir = join(PLUGINS_DIR, pluginId)
  const modalAppPath = join(pluginDir, 'modal_app.py')

  if (!existsSync(modalAppPath)) {
    return { success: false, error: `modal_app.py not found in plugin directory: ${pluginDir}` }
  }

  const appName = `flowscale-${deployId}`

  // Mark as deploying
  _deployingPlugins.add(`${pluginId}:${deployId}`)
  addDeployment(pluginId, {
    id: deployId,
    name,
    status: 'deploying',
    appName,
    url: '',
    gpu,
    deployedAt: Date.now(),
  })

  try {
    const result = await runHelper(['deploy', pluginDir, gpu, appName])

    if (result.success) {
      updateDeployment(pluginId, deployId, {
        status: 'deployed',
        appName: result.appName as string,
        url: result.url as string,
        deployedAt: Date.now(),
      })
      return { success: true, appName: result.appName as string, url: result.url as string }
    } else {
      // Deploy failed — remove the deploying record
      removeDeployment(pluginId, deployId)
      return { success: false, error: result.error as string }
    }
  } finally {
    _deployingPlugins.delete(`${pluginId}:${deployId}`)
  }
}

export async function undeployFromModal(
  pluginId: string,
  deployId: string,
): Promise<{ success: boolean; error?: string }> {
  const deployments = readDeployments()
  const records = deployments[pluginId] ?? []
  const record = records.find((r) => r.id === deployId)
  if (!record) return { success: true } // Already not deployed

  await runHelper(['undeploy', record.appName])
  removeDeployment(pluginId, deployId)
  return { success: true }
}

export function getDeployments(pluginId: string): ModalDeploymentRecord[] {
  return readDeployments()[pluginId] ?? []
}

export function getDeploymentById(pluginId: string, deployId: string): ModalDeploymentRecord | null {
  const records = readDeployments()[pluginId] ?? []
  return records.find((r) => r.id === deployId) ?? null
}

// ── Auto-routing ─────────────────────────────────────────────────────────────

const _modalRouteCounters = new Map<string, number>()

/** Round-robin across deployed (non-deploying) instances for a plugin. */
export function autoRouteModalDeployment(pluginId: string): ModalDeploymentRecord | null {
  const records = (readDeployments()[pluginId] ?? []).filter((r) => r.status === 'deployed')
  if (records.length === 0) return null
  if (records.length === 1) return records[0]

  const current = _modalRouteCounters.get(pluginId) ?? 0
  const next = (current + 1) % records.length
  _modalRouteCounters.set(pluginId, next)
  return records[current]
}

/** Get the stored Modal endpoint URL for a specific deployment (fast, no SDK call). */
export function getModalDeployUrl(pluginId: string, deployId: string): string | null {
  const record = getDeploymentById(pluginId, deployId)
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

/** Fetch combined deploy + runtime logs via helper for all deployments. */
export async function getModalLogs(pluginId: string): Promise<string> {
  const records = (readDeployments()[pluginId] ?? []).filter(r => r.status === 'deployed')
  const pluginDir = join(PLUGINS_DIR, pluginId)

  if (records.length === 0) {
    // No deployed apps — just return deploy logs from disk
    return getModalDeployLogs(pluginId)
  }

  // Fetch runtime logs from each deployed app in parallel
  const results = await Promise.all(
    records.map(async (r) => {
      const result = await runHelper(['logs', pluginDir, r.appName])
      const logs = (result.logs as string) ?? ''
      return logs ? `── ${r.name} (${r.gpu}) ──\n${logs}` : ''
    })
  )

  return results.filter(Boolean).join('\n\n')
}
