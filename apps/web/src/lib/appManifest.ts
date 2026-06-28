export const ALLOWED_PERMISSIONS = [
  'tools',
  'providers:fal',
  'providers:replicate',
  'providers:openrouter',
  'providers:huggingface',
  'storage:readwrite',
  'storage:files',
] as const

export type Permission = (typeof ALLOWED_PERMISSIONS)[number]

export const ALLOWED_SLOTS = ['main-app', 'canvas-plugin', 'tool-panel'] as const
export type AppSlot = (typeof ALLOWED_SLOTS)[number]

export interface AppManifest {
  name: string
  displayName: string
  description?: string
  version: string
  sdk: string
  entry: string
  icon?: string
  tools_used?: string[]
  permissions: Permission[]
  custom_tools?: unknown[]
  capabilities: {
    slots: AppSlot[]
  }
}

const SAFE_NAME_RE = /^[a-zA-Z0-9_-]+$/

export function parseManifest(json: unknown): AppManifest {
  if (!json || typeof json !== 'object') {
    throw new Error('Manifest must be a JSON object')
  }
  const m = json as Record<string, unknown>

  const required = ['name', 'displayName', 'version', 'sdk', 'entry', 'permissions', 'capabilities']
  for (const field of required) {
    if (!(field in m) || m[field] === undefined || m[field] === null || m[field] === '') {
      throw new Error(`Manifest missing required field: ${field}`)
    }
  }

  if (typeof m.name !== 'string' || !SAFE_NAME_RE.test(m.name)) {
    throw new Error(
      'Manifest "name" must contain only alphanumeric characters, hyphens, and underscores',
    )
  }

  if (typeof m.entry !== 'string' || m.entry.includes('..')) {
    throw new Error('Manifest "entry" must not contain path traversal sequences')
  }

  if (!Array.isArray(m.permissions)) {
    throw new Error('Manifest "permissions" must be an array')
  }
  for (const perm of m.permissions as unknown[]) {
    if (!ALLOWED_PERMISSIONS.includes(perm as Permission)) {
      throw new Error(
        `Unknown permission "${perm}". Allowed: ${ALLOWED_PERMISSIONS.join(', ')}`,
      )
    }
  }

  const caps = m.capabilities as Record<string, unknown> | undefined
  if (!caps || !Array.isArray(caps.slots)) {
    throw new Error('Manifest "capabilities.slots" must be an array')
  }
  for (const slot of caps.slots as unknown[]) {
    if (!ALLOWED_SLOTS.includes(slot as AppSlot)) {
      throw new Error(
        `Unknown slot "${slot}". Allowed: ${ALLOWED_SLOTS.join(', ')}`,
      )
    }
  }

  return m as unknown as AppManifest
}
