/**
 * Modal ComfyUI instance manager.
 *
 * Manages shared ComfyUI instances on Modal. Uses virtual port mapping
 * (50001-50999) so existing proxy and execution routes work unchanged.
 */

import { readFileSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { atomicWriteJsonSync } from './atomicWrite'

// ── Types ────────────────────────────────────────────────────────────────────

export interface ModalComfyInstance {
  id: string
  name: string
  status: 'deploying' | 'deployed' | 'error'
  errorMessage?: string
  gpu: string
  virtualPort: number
  appName: string
  url: string
  deployedAt: number
}

// ── Constants ────────────────────────────────────────────────────────────────

const MODAL_COMFY_PORT_BASE = 50000
const MODAL_COMFY_PORT_MAX = 50999
const AIOS_DIR = join(homedir(), '.flowscale', 'aios')
const INSTANCES_FILE = join(AIOS_DIR, 'modal-comfyui.json')

// ── Persistence ──────────────────────────────────────────────────────────────

function readInstances(): ModalComfyInstance[] {
  try {
    return JSON.parse(readFileSync(INSTANCES_FILE, 'utf-8')) as ModalComfyInstance[]
  } catch {
    return []
  }
}

function writeInstances(instances: ModalComfyInstance[]): void {
  atomicWriteJsonSync(INSTANCES_FILE, instances)
}

// ── Public API ───────────────────────────────────────────────────────────────

export function getModalComfyInstances(): ModalComfyInstance[] {
  return readInstances()
}

export function getModalComfyByPort(port: number): ModalComfyInstance | null {
  return readInstances().find(i => i.virtualPort === port) ?? null
}

export function getModalComfyById(id: string): ModalComfyInstance | null {
  return readInstances().find(i => i.id === id) ?? null
}

export function isModalComfyPort(port: number): boolean {
  return port > MODAL_COMFY_PORT_BASE && port <= MODAL_COMFY_PORT_MAX
}

/** Central URL resolver — used by proxy, execution route, WS bridge, and all ComfyUI API calls. */
export function resolveComfyBaseUrl(port: number): string {
  if (isModalComfyPort(port)) {
    const instance = getModalComfyByPort(port)
    if (!instance || instance.status !== 'deployed' || !instance.url) {
      throw new Error(`Modal ComfyUI instance for virtual port ${port} not found or not deployed`)
    }
    return instance.url
  }
  return `http://127.0.0.1:${port}`
}

/** Allocate next available virtual port (reuses freed ports). */
export function allocateVirtualPort(): number {
  const instances = readInstances()
  const usedPorts = new Set(instances.map(i => i.virtualPort))
  for (let port = MODAL_COMFY_PORT_BASE + 1; port <= MODAL_COMFY_PORT_MAX; port++) {
    if (!usedPorts.has(port)) return port
  }
  throw new Error('No more virtual ports available')
}

export function addModalComfyInstance(instance: ModalComfyInstance): void {
  const instances = readInstances()
  instances.push(instance)
  writeInstances(instances)
}

export function updateModalComfyInstance(id: string, updates: Partial<ModalComfyInstance>): void {
  const instances = readInstances()
  const idx = instances.findIndex(i => i.id === id)
  if (idx >= 0) {
    instances[idx] = { ...instances[idx], ...updates }
    writeInstances(instances)
  }
}

export function removeModalComfyInstance(id: string): void {
  const instances = readInstances().filter(i => i.id !== id)
  writeInstances(instances)
}

export function isModalComfyDeploying(): boolean {
  return readInstances().some(i => i.status === 'deploying')
}

// Auto-routing for Modal ComfyUI instances
const _modalComfyRouteCounter = { value: 0 }

export function autoRouteModalComfy(): ModalComfyInstance | null {
  const deployed = readInstances().filter(i => i.status === 'deployed')
  if (deployed.length === 0) return null
  const idx = _modalComfyRouteCounter.value % deployed.length
  _modalComfyRouteCounter.value++
  return deployed[idx]
}
