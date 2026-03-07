import crypto from 'crypto'
import type { ModelRow } from './db/schema'

type ModelType = 'checkpoint' | 'lora' | 'vae' | 'controlnet' | 'upscaler' | 'other'

const FOLDER_TYPE_MAP: Record<string, ModelType> = {
  checkpoints: 'checkpoint',
  loras: 'lora',
  vae: 'vae',
  controlnet: 'controlnet',
  upscale_models: 'upscaler',
}

const COMFY_MODEL_ENDPOINTS: Array<{ path: string; folder: string }> = [
  { path: '/models/checkpoints', folder: 'checkpoints' },
  { path: '/models/loras', folder: 'loras' },
  { path: '/models/vae', folder: 'vae' },
  { path: '/models/controlnet', folder: 'controlnet' },
  { path: '/models/upscale_models', folder: 'upscale_models' },
]

export interface ScannedModel {
  id: string
  filename: string
  path: string
  type: ModelType
  sizeBytes: number | null
  comfyPort: number
  scannedAt: number
}

function makeId(port: number, filename: string): string {
  return crypto.createHash('sha256').update(`${port}:${filename}`).digest('hex').slice(0, 32)
}

/**
 * Fetch model lists from a live ComfyUI instance and return scanned model rows.
 */
export async function scanComfyModels(comfyPort: number): Promise<ScannedModel[]> {
  const results: ScannedModel[] = []
  const now = Date.now()

  for (const { path: endpoint, folder } of COMFY_MODEL_ENDPOINTS) {
    try {
      const res = await fetch(`http://127.0.0.1:${comfyPort}${endpoint}`, {
        signal: AbortSignal.timeout(5000),
      })
      if (!res.ok) continue

      const files = await res.json() as string[]
      const modelType = FOLDER_TYPE_MAP[folder] ?? 'other'

      for (const filename of files) {
        if (!filename || typeof filename !== 'string') continue
        const filePath = `${folder}/${filename}`
        results.push({
          id: makeId(comfyPort, filePath),
          filename,
          path: filePath,
          type: modelType,
          sizeBytes: null, // ComfyUI doesn't expose file sizes via this endpoint
          comfyPort,
          scannedAt: now,
        })
      }
    } catch {
      // Skip unreachable endpoint
    }
  }

  return results
}

/**
 * Query the local DB for models matching a filename (case-insensitive).
 * Returns filenames indexed by port.
 */
export function buildLocalModelIndex(
  rows: ModelRow[],
): Map<string, Set<string>> {
  const index = new Map<string, Set<string>>()
  for (const row of rows) {
    const key = String(row.comfyPort)
    if (!index.has(key)) index.set(key, new Set())
    index.get(key)!.add(row.filename.toLowerCase())
  }
  return index
}
