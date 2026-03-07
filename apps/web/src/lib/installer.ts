import fs from 'fs'
import path from 'path'
import os from 'os'
import type { AppRegistryEntry, CustomNodeRequirement } from './registry/appRegistry'
import { getRegistryTool } from './registry'
import { checkModels } from './registry/modelChecker'
import { getProviderKey, getComfyUIPath } from './providerSettings'
import type { ProviderName } from './providerSettings'

export interface MissingModel {
  toolId: string
  modelLabel: string
  folder: string
  filename: string
  downloadUrl?: string
}

export interface MissingCustomNode extends CustomNodeRequirement {
  alreadyInstalled: false
}

export interface InstallDepsResult {
  ok: boolean
  missingModels: MissingModel[]
  missingCustomNodes: CustomNodeRequirement[]
  unconfiguredProviders: string[]
}

function getComfyCustomNodesDir(): string | null {
  const comfyPath = getComfyUIPath()
  if (!comfyPath) return null
  return path.join(comfyPath, 'custom_nodes')
}

function isCustomNodeInstalled(repo: string): boolean {
  const customNodesDir = getComfyCustomNodesDir()
  if (!customNodesDir || !fs.existsSync(customNodesDir)) return false
  // Derive folder name from repo URL (last segment, strip .git)
  const repoName = repo.split('/').pop()?.replace(/\.git$/, '') ?? ''
  return fs.existsSync(path.join(customNodesDir, repoName))
}

/**
 * Check whether a registry app's dependencies are satisfied.
 * @param entry  App registry entry
 * @param comfyPort  ComfyUI port to probe for models (default 8188)
 */
export async function checkInstallDeps(
  entry: AppRegistryEntry,
  comfyPort = 8188,
): Promise<InstallDepsResult> {
  const missingModels: InstallDepsResult['missingModels'] = []
  const missingCustomNodes: InstallDepsResult['missingCustomNodes'] = []
  const unconfiguredProviders: string[] = []

  // Check tools_used model requirements
  for (const toolId of entry.tools_used ?? []) {
    const tool = getRegistryTool(toolId)
    if (!tool || tool.requiredModels.length === 0) continue

    const check = await checkModels(tool, comfyPort)
    for (const m of check.missing) {
      missingModels.push({
        toolId,
        modelLabel: m.label,
        folder: m.folder,
        filename: m.filename,
        downloadUrl: m.downloadUrl,
      })
    }
  }

  // Check custom node requirements
  for (const node of entry.customNodes ?? []) {
    if (!isCustomNodeInstalled(node.repo)) {
      missingCustomNodes.push(node)
    }
  }

  // Check provider permissions
  const PROVIDER_PERMS = ['providers:fal', 'providers:replicate', 'providers:openrouter', 'providers:huggingface']
  for (const perm of entry.permissions) {
    if (!PROVIDER_PERMS.includes(perm)) continue
    const providerName = perm.replace('providers:', '') as ProviderName
    if (!getProviderKey(providerName)) {
      unconfiguredProviders.push(providerName)
    }
  }

  return {
    ok: missingModels.length === 0 && missingCustomNodes.length === 0 && unconfiguredProviders.length === 0,
    missingModels,
    missingCustomNodes,
    unconfiguredProviders,
  }
}
