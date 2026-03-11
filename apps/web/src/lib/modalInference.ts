/**
 * Modal.com inference — generic dispatch layer for API-engine tools.
 *
 * Any tool with engine: 'api' can have a Modal endpoint registered for its
 * model ID. The endpoint must follow the FlowScale Modal contract:
 *
 *   POST <url>
 *     body:  { inputs: Record<string, unknown>, seed: number }
 *     reply: { outputs: Array<{ kind: 'image'|'text'|'video', filename: string, data: string }> }
 *              data is base64-encoded for binary kinds (image/video), plain string for text.
 *
 *   GET <url>/health   →   { status: 'ok', model: string }  (optional, used by test button)
 *
 * Auth: if a key is stored, it is sent as  Authorization: Bearer <key>.
 *
 * Config is persisted in ~/.flowscale/aios/settings.json under the key
 * "modalEndpoints": { "<modelId>": { url, key? } }
 */

import fs from 'fs'
import path from 'path'
import os from 'os'

export interface ModalEndpointConfig {
  url: string
  key?: string
  /** Modal app name used to stream logs, e.g. "z-image-turbo" */
  appName?: string
}

export interface ModalOutput {
  kind: 'image' | 'text' | 'video'
  filename: string
  /** base64-encoded for image/video; plain string for text */
  data: string
}

// ── Settings storage ──────────────────────────────────────────────────────────

const SETTINGS_FILE = path.join(os.homedir(), '.flowscale', 'aios', 'settings.json')

function readSettings(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf-8')) as Record<string, unknown>
  } catch {
    return {}
  }
}

function writeSettings(settings: Record<string, unknown>): void {
  fs.mkdirSync(path.dirname(SETTINGS_FILE), { recursive: true })
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, null, 2), 'utf-8')
}

function getModalMap(): Record<string, ModalEndpointConfig> {
  const s = readSettings()
  return (s['modalEndpoints'] as Record<string, ModalEndpointConfig>) ?? {}
}

export function getModalEndpointConfig(modelId: string): ModalEndpointConfig | null {
  return getModalMap()[modelId] ?? null
}

export function setModalEndpointConfig(modelId: string, config: ModalEndpointConfig): void {
  const s = readSettings()
  const map = (s['modalEndpoints'] as Record<string, ModalEndpointConfig>) ?? {}
  map[modelId] = config
  s['modalEndpoints'] = map
  writeSettings(s)
}

export function removeModalEndpointConfig(modelId: string): void {
  const s = readSettings()
  const map = (s['modalEndpoints'] as Record<string, ModalEndpointConfig>) ?? {}
  delete map[modelId]
  s['modalEndpoints'] = map
  writeSettings(s)
}

export function listModalEndpointConfigs(): Array<{ modelId: string } & ModalEndpointConfig> {
  return Object.entries(getModalMap()).map(([modelId, cfg]) => ({ modelId, ...cfg }))
}

// ── HTTP call ─────────────────────────────────────────────────────────────────

export async function callModalEndpoint(
  config: ModalEndpointConfig,
  inputs: Record<string, unknown>,
  seed: number,
  signal: AbortSignal,
): Promise<ModalOutput[]> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (config.key) headers['Authorization'] = `Bearer ${config.key}`

  const res = await fetch(config.url, {
    method: 'POST',
    headers,
    body: JSON.stringify({ inputs, seed }),
    signal,
  })

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText)
    throw new Error(`Modal endpoint returned ${res.status}: ${text}`)
  }

  const body = await res.json() as { outputs?: ModalOutput[] }
  if (!Array.isArray(body.outputs)) {
    throw new Error('Modal endpoint returned unexpected shape — missing "outputs" array')
  }
  return body.outputs
}
