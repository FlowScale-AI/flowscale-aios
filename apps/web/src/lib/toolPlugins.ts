/**
 * Tool Plugin Registry — discovers and manages API-engine tool plugins.
 *
 * Plugins live at ~/.flowscale/tool-plugins/{id}/ with a manifest.json and server.py.
 * Official plugins are listed in a remote registry.json on S3 and downloaded as zips.
 * Custom plugins can be dropped into the plugins dir and are auto-registered on startup.
 */
import fs from 'fs'
import path from 'path'
import os from 'os'
import crypto from 'crypto'
import AdmZip from 'adm-zip'

// ── Manifest types ───────────────────────────────────────────────────────────

export interface PluginSchemaInput {
  paramName: string
  paramType: 'string' | 'number' | 'boolean' | 'image' | 'select'
  defaultValue?: unknown
  label: string
  options?: string[]
}

export interface PluginSchemaOutput {
  paramName: string
  paramType: 'image' | 'video'
  label: string
}

export interface ToolPluginManifest {
  id: string
  version: string
  name: string
  description: string
  badge: string
  model: string
  engine: 'api'
  server: {
    type: 'local'
    script: string
    port: number
    healthEndpoint: string
    generateEndpoint: string
  }
  dependencies?: {
    python: string
    packages: string[]
  }
  schema: {
    inputs: PluginSchemaInput[]
    outputs: PluginSchemaOutput[]
  }
}

// ── Registry types ───────────────────────────────────────────────────────────

export interface RegistryEntry {
  id: string
  name: string
  description: string
  badge: string
  version: string
  s3Url: string
}

const REGISTRY_URL = process.env.FLOWSCALE_REGISTRY_URL
  ?? 'https://flowscale.ai/tools/registry.json'

// ── Paths ────────────────────────────────────────────────────────────────────

const PLUGINS_DIR = path.join(os.homedir(), '.flowscale', 'tool-plugins')
const AIOS_DIR = path.join(os.homedir(), '.flowscale', 'aios')
const REGISTRY_CACHE_FILE = path.join(AIOS_DIR, 'registry-cache.json')

export function getPluginsDir(): string {
  return PLUGINS_DIR
}

export function getPluginDir(pluginId: string): string {
  return path.join(PLUGINS_DIR, pluginId)
}

// ── Local plugin discovery ───────────────────────────────────────────────────

export function scanPlugins(): ToolPluginManifest[] {
  if (!fs.existsSync(PLUGINS_DIR)) return []

  const manifests: ToolPluginManifest[] = []

  for (const dir of fs.readdirSync(PLUGINS_DIR)) {
    const pluginPath = path.join(PLUGINS_DIR, dir)
    if (!fs.statSync(pluginPath).isDirectory()) continue

    const manifestPath = path.join(pluginPath, 'manifest.json')
    if (!fs.existsSync(manifestPath)) continue

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ToolPluginManifest
      if (!raw.id || !raw.name || !raw.engine || !raw.server || !raw.schema || !raw.server.type) continue
      manifests.push(raw)
    } catch {
      // Skip malformed manifests
    }
  }

  return manifests
}

export function getPlugin(id: string): ToolPluginManifest | undefined {
  return scanPlugins().find((p) => p.id === id)
}

// ── Remote registry ──────────────────────────────────────────────────────────

let _registryCache: { entries: RegistryEntry[]; fetchedAt: number } | null = null
const REGISTRY_TTL_MS = 5 * 60 * 1000 // 5 minutes

export async function fetchRegistry(): Promise<RegistryEntry[]> {
  // Return in-memory cache if fresh
  if (_registryCache && Date.now() - _registryCache.fetchedAt < REGISTRY_TTL_MS) {
    return _registryCache.entries
  }

  try {
    const res = await fetch(REGISTRY_URL, { signal: AbortSignal.timeout(10_000) })
    if (!res.ok) return _registryCache?.entries ?? readRegistryCache()

    const data = await res.json() as { version?: number; tools?: RegistryEntry[] }
    const entries = data.tools ?? []

    // Update caches
    _registryCache = { entries, fetchedAt: Date.now() }
    writeRegistryCache(entries)

    return entries
  } catch {
    // Network failure — use stale cache
    return _registryCache?.entries ?? readRegistryCache()
  }
}

function readRegistryCache(): RegistryEntry[] {
  try {
    const raw = JSON.parse(fs.readFileSync(REGISTRY_CACHE_FILE, 'utf-8')) as { tools?: RegistryEntry[] }
    return raw.tools ?? []
  } catch {
    return []
  }
}

function writeRegistryCache(entries: RegistryEntry[]): void {
  try {
    fs.mkdirSync(path.dirname(REGISTRY_CACHE_FILE), { recursive: true, mode: 0o700 })
    fs.writeFileSync(REGISTRY_CACHE_FILE, JSON.stringify({ tools: entries }, null, 2), { encoding: 'utf-8', mode: 0o600 })
  } catch { /* non-fatal */ }
}

/** Get the set of official plugin IDs from the disk cache (sync, for startup use). */
export function getCachedRegistryIds(): Set<string> {
  const entries = readRegistryCache()
  return new Set(entries.map((e) => e.id))
}

// ── Download & extract from S3 ──────────────────────────────────────────────

export async function downloadAndExtractPlugin(entry: RegistryEntry): Promise<ToolPluginManifest> {
  const destDir = path.join(PLUGINS_DIR, entry.id)
  const tmpDir = path.join(os.homedir(), '.flowscale', 'tmp')
  const tmpZip = path.join(tmpDir, `${entry.id}.zip`)

  fs.mkdirSync(tmpDir, { recursive: true })
  fs.mkdirSync(PLUGINS_DIR, { recursive: true })

  try {
    // Validate URL protocol before downloading
    const downloadUrl = new URL(entry.s3Url)
    if (!['https:', 'http:'].includes(downloadUrl.protocol)) {
      throw new Error(`Invalid plugin download URL protocol: ${downloadUrl.protocol}`)
    }

    // Download zip
    const res = await fetch(entry.s3Url, { signal: AbortSignal.timeout(300_000) })
    if (!res.ok) throw new Error(`Failed to download plugin: ${res.status} ${res.statusText}`)

    const buffer = Buffer.from(await res.arrayBuffer())
    fs.writeFileSync(tmpZip, buffer)

    // Extract — overwrite existing (validate entries first to prevent path traversal)
    const zip = new AdmZip(tmpZip)
    for (const entry of zip.getEntries()) {
      const entryName = entry.entryName
      if (entryName.includes('..') || path.isAbsolute(entryName)) {
        throw new Error(`Unsafe zip entry detected: ${entryName}`)
      }
    }
    zip.extractAllTo(destDir, true)

    // Parse and return the manifest
    const manifestPath = path.join(destDir, 'manifest.json')
    if (!fs.existsSync(manifestPath)) {
      throw new Error('Downloaded plugin is missing manifest.json')
    }
    return JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as ToolPluginManifest
  } finally {
    // Clean up temp file
    try { fs.unlinkSync(tmpZip) } catch { /* ignore */ }
  }
}

// ── DB registration helper ───────────────────────────────────────────────────

type DbType = ReturnType<typeof import('@/lib/db').getDb>

/**
 * Register a plugin as a tool in the database. Returns the created/existing tool.
 * `source` is 'registry' for official tools, 'custom' for user-added plugins.
 */
export async function registerPluginInDb(
  db: DbType,
  plugin: ToolPluginManifest,
  source: 'registry' | 'custom',
) {
  // Lazy import to avoid circular dependency
  const { tools } = await import('@/lib/db/schema')
  const { eq } = await import('drizzle-orm')

  const toolId = `${plugin.id}-builtin`

  const existing = await db.select().from(tools).where(eq(tools.id, toolId))
  if (existing.length > 0) return existing[0]

  const workflowJson = JSON.stringify({ engine: 'api', model: plugin.model, pluginId: plugin.id })
  const workflowHash = crypto.createHash('sha256').update(workflowJson).digest('hex')

  await db.insert(tools).values({
    id: toolId,
    name: plugin.name,
    description: plugin.description,
    engine: plugin.engine,
    workflowJson,
    workflowHash,
    schemaJson: JSON.stringify(manifestToDbSchema(plugin)),
    layout: 'left-right',
    status: 'production',
    source,
    createdAt: Date.now(),
  })

  const [tool] = await db.select().from(tools).where(eq(tools.id, toolId))
  return tool
}

// ── Auto-register custom plugins ─────────────────────────────────────────────

/**
 * Scan ~/.flowscale/tool-plugins/ and auto-register any plugins that are NOT
 * in the official registry into the tools DB. Called on startup and via Refresh.
 */
export async function autoRegisterCustomPlugins(db: DbType): Promise<string[]> {
  const registryIds = getCachedRegistryIds()
  const plugins = scanPlugins()
  const registered: string[] = []

  for (const plugin of plugins) {
    // Skip official registry plugins — those are installed explicitly
    if (registryIds.has(plugin.id)) continue

    try {
      const result = await registerPluginInDb(db, plugin, 'custom')
      if (result) registered.push(plugin.id)
    } catch {
      // Skip plugins that fail to register
    }
  }

  return registered
}

// ── Schema helpers ───────────────────────────────────────────────────────────

export function manifestToDbSchema(manifest: ToolPluginManifest): object[] {
  const nodeType = manifest.id
    .split('-')
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join('')

  const inputs = manifest.schema.inputs.map((input) => ({
    nodeId: 'api',
    nodeType,
    nodeTitle: manifest.name,
    paramName: input.paramName,
    paramType: input.paramType,
    defaultValue: input.defaultValue,
    label: input.label,
    options: input.options,
    isInput: true,
    enabled: true,
  }))

  const outputs = manifest.schema.outputs.map((output) => ({
    nodeId: 'api_output',
    nodeType: output.paramType === 'video' ? 'APIVideoOutput' : 'APIImageOutput',
    nodeTitle: output.label,
    paramName: output.paramName,
    paramType: output.paramType === 'video' ? 'image' : output.paramType,
    isInput: false,
    enabled: true,
  }))

  return [...inputs, ...outputs]
}
