import fs from 'fs'
import path from 'path'
import os from 'os'

export interface CustomNodeRequirement {
  /** Human-readable name */
  name: string
  /** Git repository URL to clone */
  repo: string
  /** pip requirements file relative to cloned dir (default: requirements.txt) */
  requirementsFile?: string
}

export interface AppRegistryEntry {
  id: string
  name: string
  displayName: string
  description: string
  category: 'creative' | 'production' | 'utility' | 'research'
  author: string
  repository?: string
  latestRelease: string
  /** Absolute path to the app bundle directory */
  releaseAssetUrl: string
  icon?: string
  screenshots?: string[]
  tools_used?: string[]
  /** ComfyUI custom nodes required by this app */
  customNodes?: CustomNodeRequirement[]
  permissions: string[]
  capabilities: {
    slots: string[]
  }
}

const APPS_DIR = path.join(os.homedir(), '.flowscale', 'apps')

function scanRegistry(): AppRegistryEntry[] {
  if (!fs.existsSync(APPS_DIR)) return []

  const entries: AppRegistryEntry[] = []

  for (const dir of fs.readdirSync(APPS_DIR)) {
    const bundlePath = path.join(APPS_DIR, dir)
    if (!fs.statSync(bundlePath).isDirectory()) continue

    const manifestPath = path.join(bundlePath, 'flowscale.app.json')
    if (!fs.existsSync(manifestPath)) continue

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8')) as Record<string, unknown>
      entries.push({
        id: dir,
        name: (raw.name as string) ?? dir,
        displayName: (raw.displayName as string) ?? dir,
        description: (raw.description as string) ?? '',
        category: (raw.category as AppRegistryEntry['category']) ?? 'utility',
        author: (raw.author as string) ?? 'FlowScale',
        repository: raw.repository as string | undefined,
        latestRelease: (raw.version as string) ?? '0.1.0',
        releaseAssetUrl: bundlePath,
        icon: raw.icon as string | undefined,
        screenshots: raw.screenshots as string[] | undefined,
        tools_used: raw.tools_used as string[] | undefined,
        customNodes: raw.customNodes as CustomNodeRequirement[] | undefined,
        permissions: (raw.permissions as string[]) ?? [],
        capabilities: (raw.capabilities as { slots: string[] }) ?? { slots: [] },
      })
    } catch {
      // Skip malformed manifests
    }
  }

  return entries
}

export function getRegistryEntry(id: string): AppRegistryEntry | undefined {
  return scanRegistry().find((e) => e.id === id)
}

export function searchRegistry(query?: string, category?: string): AppRegistryEntry[] {
  let results = scanRegistry()
  if (category) results = results.filter((e) => e.category === category)
  if (query) {
    const q = query.toLowerCase()
    results = results.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.displayName.toLowerCase().includes(q) ||
        e.description.toLowerCase().includes(q),
    )
  }
  return results
}

// Keep for callers that import APP_REGISTRY directly
export const APP_REGISTRY: AppRegistryEntry[] = scanRegistry()
