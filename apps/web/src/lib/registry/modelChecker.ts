import type { RegistryTool, RegistryModelRequirement, ModelCheckResult } from './types'
import { getDb } from '@/lib/db'
import { models as modelsTable } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

/**
 * Checks which required models for a tool are available on a ComfyUI instance.
 * First queries the local models DB index; falls back to live object_info if DB is empty.
 */
export async function checkModels(
  tool: RegistryTool,
  comfyPort: number,
): Promise<ModelCheckResult> {
  if (tool.requiredModels.length === 0) {
    return { toolId: tool.id, ready: true, missing: [], present: [] }
  }

  // Try DB first
  let folderLists: Record<string, string[]> = {}
  try {
    const db = getDb()
    const rows = await db
      .select()
      .from(modelsTable)
      .where(eq(modelsTable.comfyPort, comfyPort))

    if (rows.length > 0) {
      for (const row of rows) {
        const folder = typeToFolder(row.type)
        if (!folderLists[folder]) folderLists[folder] = []
        folderLists[folder].push(row.filename)
      }
    } else {
      // Fall back to live object_info
      const res = await fetch(`/api/comfy/${comfyPort}/object_info`)
      if (res.ok) {
        const info = await res.json() as Record<string, unknown>
        folderLists = extractFolderLists(info)
      }
    }
  } catch {
    // ComfyUI unreachable — assume all missing
    return {
      toolId: tool.id,
      ready: false,
      missing: tool.requiredModels,
      present: [],
    }
  }

  const present: RegistryModelRequirement[] = []
  const missing: RegistryModelRequirement[] = []

  for (const req of tool.requiredModels) {
    const available = folderLists[req.folder] ?? []
    const found = available.some((f) => matchesFilename(f, req.filename))
    if (found) {
      present.push(req)
    } else {
      missing.push(req)
    }
  }

  return {
    toolId: tool.id,
    ready: missing.length === 0,
    missing,
    present,
  }
}

/**
 * Batch check multiple tools at once against a single ComfyUI instance.
 */
export async function checkModelsForTools(
  tools: RegistryTool[],
  comfyPort: number,
): Promise<ModelCheckResult[]> {
  return Promise.all(tools.map((t) => checkModels(t, comfyPort)))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function matchesFilename(actual: string, pattern: string): boolean {
  if (!pattern.includes('*')) return actual === pattern
  const regex = new RegExp('^' + pattern.split('*').map(escapeRegex).join('.*') + '$')
  return regex.test(actual)
}

function escapeRegex(s: string): string {
  return s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
}

function typeToFolder(type: string): string {
  const map: Record<string, string> = {
    checkpoint: 'checkpoints',
    lora: 'loras',
    vae: 'vae',
    controlnet: 'controlnet',
    upscaler: 'upscale_models',
  }
  return map[type] ?? type
}

/**
 * Parse object_info to extract available filenames per folder type.
 * ComfyUI's object_info encodes model lists as the first element of combo input arrays.
 */
function extractFolderLists(objectInfo: Record<string, unknown>): Record<string, string[]> {
  const result: Record<string, string[]> = {}

  const folderNodeMap: Record<string, { nodeType: string; inputName: string }> = {
    checkpoints: { nodeType: 'CheckpointLoaderSimple', inputName: 'ckpt_name' },
    loras: { nodeType: 'LoraLoader', inputName: 'lora_name' },
    controlnet: { nodeType: 'ControlNetLoader', inputName: 'control_net_name' },
    upscale_models: { nodeType: 'UpscaleModelLoader', inputName: 'model_name' },
    ipadapter: { nodeType: 'IPAdapterModelLoader', inputName: 'ipadapter_file' },
    clip_vision: { nodeType: 'CLIPVisionLoader', inputName: 'clip_name' },
    animatediff_models: { nodeType: 'ADE_LoadAnimateDiffModel', inputName: 'model_name' },
    vae: { nodeType: 'VAELoader', inputName: 'vae_name' },
    facerestore_models: { nodeType: 'FaceRestoreModelLoader', inputName: 'model_name' },
    facedetection: { nodeType: 'FaceRestoreModelLoader', inputName: 'model_name' },
    rembg: { nodeType: 'BRIA_RMBG_ModelLoader', inputName: 'model_name' },
  }

  for (const [folder, { nodeType, inputName }] of Object.entries(folderNodeMap)) {
    try {
      const nodeDef = objectInfo[nodeType] as Record<string, unknown> | undefined
      const required = (nodeDef?.input as Record<string, unknown> | undefined)?.required as
        | Record<string, unknown>
        | undefined
      const inputDef = required?.[inputName]
      if (Array.isArray(inputDef) && Array.isArray(inputDef[0])) {
        result[folder] = inputDef[0] as string[]
      }
    } catch {
      // ignore parse errors for individual nodes
    }
  }

  return result
}
