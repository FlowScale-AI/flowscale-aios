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
  /** URL or local absolute path to a ZIP bundle or a directory */
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

import registryJson from './appRegistry.json'

export const APP_REGISTRY: AppRegistryEntry[] = registryJson as AppRegistryEntry[]

export function getRegistryEntry(id: string): AppRegistryEntry | undefined {
  return APP_REGISTRY.find((e) => e.id === id)
}

export function searchRegistry(query?: string, category?: string): AppRegistryEntry[] {
  let results = APP_REGISTRY
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
