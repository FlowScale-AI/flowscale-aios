import fs from 'fs'
import path from 'path'
import os from 'os'

export type ProviderName = 'fal' | 'replicate' | 'openrouter' | 'huggingface'

// ── ComfyUI settings ──────────────────────────────────────────────────────────

const SETTINGS_FILE = path.join(os.homedir(), '.flowscale', 'aios', 'settings.json')

function readSettingsFile(): Record<string, string> {
  try {
    const raw = fs.readFileSync(SETTINGS_FILE, 'utf-8')
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}

function writeSettingsFile(settings: Record<string, string>): void {
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
