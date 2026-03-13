import fs from 'fs'
import path from 'path'
import os from 'os'

export type ProviderName = 'fal' | 'replicate' | 'openrouter' | 'huggingface'

// ── ComfyUI settings ──────────────────────────────────────────────────────────

const SETTINGS_FILE = path.join(os.homedir(), '.flowscale', 'aios', 'settings.json')

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readSettingsFile(): Record<string, any> {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return JSON.parse(raw) as Record<string, any>
  } catch {
    return {}
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function writeSettingsFile(settings: Record<string, any>): void {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
}

export function getComfyUIPath(): string | undefined {
  return readSettingsFile()['comfyuiPath'] || undefined
}

export function setComfyUIPath(p: string): void {
  const settings = readSettingsFile()
  settings['comfyuiPath'] = p
  writeSettingsFile(settings)
}

// ── ComfyUI managed instance settings ─────────────────────────────────────────

export type ComfyInstallType = 'github' | 'desktop-app' | 'flowscale-managed'

export function getComfyInstallType(): ComfyInstallType | undefined {
  return readSettingsFile()['comfyInstallType'] as ComfyInstallType | undefined
}

export function setComfyInstallType(t: ComfyInstallType): void {
  const settings = readSettingsFile()
  settings['comfyInstallType'] = t
  writeSettingsFile(settings)
}

/** The port AIOS will use to start/connect its managed ComfyUI instance. */
export function getComfyManagedPort(): number {
  const raw = readSettingsFile()['comfyManagedPort']
  const parsed = raw ? parseInt(raw, 10) : NaN
  return isNaN(parsed) ? 8188 : parsed
}

export function setComfyManagedPort(port: number): void {
  const settings = readSettingsFile()
  settings['comfyManagedPort'] = String(port)
  writeSettingsFile(settings)
}

/** Path to the ComfyUI installation that AIOS manages (GitHub clone or .flowscale/comfyui). */
export function getComfyManagedPath(): string | undefined {
  // Fall back to legacy comfyuiPath if the new key isn't set
  return readSettingsFile()['comfyManagedPath'] || readSettingsFile()['comfyuiPath'] || undefined
}

export function setComfyManagedPath(p: string): void {
  const settings = readSettingsFile()
  settings['comfyManagedPath'] = p
  // Keep legacy key in sync for existing routes that read it
  settings['comfyuiPath'] = p
  writeSettingsFile(settings)
}

// ── ComfyUI multi-instance registry ──────────────────────────────────────────

export interface ComfyInstanceConfig {
  /** Stable identifier, e.g. 'gpu-0', 'cpu' */
  id: string
  /** Port this instance listens on */
  port: number
  /** Device specifier: 'cuda:0', 'rocm:1', 'cpu' */
  device: string
  /** Human-readable label, e.g. 'GPU 0 — RTX 4090' */
  label: string
}

/**
 * Returns configured ComfyUI instances.
 * Falls back to a single instance from the legacy `comfyManagedPort` key
 * if `comfyInstances` is not yet set (backward compatibility).
 */
export function getComfyInstances(): ComfyInstanceConfig[] {
  const settings = readSettingsFile()
  const arr = settings['comfyInstances']
  if (Array.isArray(arr) && arr.length > 0) return arr as ComfyInstanceConfig[]

  // Legacy fallback: synthesize a single instance from the old key
  const port = getComfyManagedPort()
  return [{ id: 'gpu-0', port, device: 'cuda:0', label: 'ComfyUI' }]
}

export function setComfyInstances(instances: ComfyInstanceConfig[]): void {
  const settings = readSettingsFile()
  settings['comfyInstances'] = instances
  // Keep legacy key in sync with the first instance
  if (instances.length > 0) {
    settings['comfyManagedPort'] = String(instances[0].port)
  }
  writeSettingsFile(settings)
}

export function getComfyInstanceById(id: string): ComfyInstanceConfig | undefined {
  return getComfyInstances().find((i) => i.id === id)
}

/** Path to the ComfyUI Desktop App's user-data folder (models, custom_nodes, configs). */
export function getComfyDesktopUserDataPath(): string | undefined {
  return readSettingsFile()['comfyDesktopUserDataPath'] || undefined
}

export function setComfyDesktopUserDataPath(p: string): void {
  const settings = readSettingsFile()
  settings['comfyDesktopUserDataPath'] = p
  writeSettingsFile(settings)
}

export function getComfyOrgApiKey(): string | undefined {
  return readSettingsFile()['comfyOrgApiKey'] || undefined
}

export function setComfyOrgApiKey(key: string): void {
  const settings = readSettingsFile()
  if (key) {
    settings['comfyOrgApiKey'] = key
  } else {
    delete settings['comfyOrgApiKey']
  }
  writeSettingsFile(settings)
}

export const PROVIDERS: Record<ProviderName, { label: string; baseUrl: string; docsUrl: string }> = {
  fal: {
    label: 'fal.ai',
    baseUrl: 'https://fal.run',
    docsUrl: 'https://fal.ai/docs',
  },
  replicate: {
    label: 'Replicate',
    baseUrl: 'https://api.replicate.com/v1',
    docsUrl: 'https://replicate.com/docs/reference/http',
  },
  openrouter: {
    label: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    docsUrl: 'https://openrouter.ai/docs',
  },
  huggingface: {
    label: 'HuggingFace',
    baseUrl: 'https://api-inference.huggingface.co',
    docsUrl: 'https://huggingface.co/docs/api-inference',
  },
}

export const ALL_PROVIDER_NAMES = Object.keys(PROVIDERS) as ProviderName[]

// ── Storage ──────────────────────────────────────────────────────────────────

const KEYS_FILE = path.join(os.homedir(), '.flowscale', 'aios', 'provider-keys.json')

function readKeysFile(): Partial<Record<ProviderName, string>> {
  try {
    const raw = fs.readFileSync(KEYS_FILE, 'utf-8')
    return JSON.parse(raw) as Partial<Record<ProviderName, string>>
  } catch {
    return {}
  }
}

function writeKeysFile(keys: Partial<Record<ProviderName, string>>): void {
  fs.mkdirSync(path.dirname(KEYS_FILE), { recursive: true })
  fs.writeFileSync(KEYS_FILE, JSON.stringify(keys, null, 2), 'utf-8')
}

// ── Public API ────────────────────────────────────────────────────────────────

export function getProviderKey(name: ProviderName): string | undefined {
  return readKeysFile()[name]
}

export function setProviderKey(name: ProviderName, key: string): void {
  const keys = readKeysFile()
  keys[name] = key
  writeKeysFile(keys)
}

export function deleteProviderKey(name: ProviderName): void {
  const keys = readKeysFile()
  delete keys[name]
  writeKeysFile(keys)
}

export function listProviders(): Array<{
  name: ProviderName
  label: string
  configured: boolean
  docsUrl: string
}> {
  const keys = readKeysFile()
  return ALL_PROVIDER_NAMES.map((name) => ({
    name,
    label: PROVIDERS[name].label,
    configured: !!keys[name],
    docsUrl: PROVIDERS[name].docsUrl,
  }))
}
