import { spawn } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, copyFileSync, mkdirSync, writeFileSync } from 'fs'
import { getDatasetDir, getDatasetSyncStatus, markDatasetSynced } from './training'
import { getComfyManagedPath } from './providerSettings'

const HELPER_SCRIPT = join(process.cwd(), 'scripts', 'modal-helper.py')
const API_OUTPUTS_DIR = join(homedir(), '.flowscale', 'aios-outputs')
const DATASETS_VOLUME = 'flowscale-training-datasets'
const OUTPUTS_VOLUME = 'flowscale-training-outputs'

export interface TrainingPayload {
  datasetId: string
  outputName: string
  triggerWord: string
  steps: number
  lr: string
  rank: number
  resolution: number
  quantize?: boolean
}

export function buildDatasetSyncArgs(datasetDir: string, datasetId: string): string[] {
  return ['sync-dataset', datasetDir, datasetId, DATASETS_VOLUME]
}

export function buildTrainingPayload(inputs: Record<string, unknown>): TrainingPayload {
  const datasetId = (inputs['api__datasetId'] ?? inputs['datasetId']) as string | undefined
  const outputName = (inputs['api__outputName'] ?? inputs['outputName']) as string | undefined
  if (!datasetId) throw new Error('datasetId is required')
  if (!outputName) throw new Error('outputName is required')

  return {
    datasetId,
    outputName,
    triggerWord: (inputs['api__triggerWord'] ?? inputs['triggerWord'] ?? 'ohwx') as string,
    steps: Number(inputs['api__steps'] ?? inputs['steps'] ?? 1000),
    lr: String(inputs['api__lr'] ?? inputs['lr'] ?? inputs['learningRate'] ?? '1e-4'),
    rank: Number(inputs['api__rank'] ?? inputs['rank'] ?? inputs['loraRank'] ?? 128),
    resolution: Number(inputs['api__resolution'] ?? inputs['resolution'] ?? 1024),
  }
}

export async function syncDatasetToModal(datasetId: string): Promise<void> {
  const syncStatus = getDatasetSyncStatus(datasetId)
  if (syncStatus.synced) return

  const datasetDir = getDatasetDir(datasetId)
  if (!existsSync(datasetDir)) throw new Error(`Dataset "${datasetId}" not found locally`)

  const args = buildDatasetSyncArgs(datasetDir, datasetId)
  const result = await runHelper(args)
  const parsed = JSON.parse(result)
  if (!parsed.success) throw new Error(parsed.error || 'Dataset sync failed')

  markDatasetSynced(datasetId)
}

export async function startModalTraining(
  modalUrl: string,
  payload: TrainingPayload,
): Promise<{ jobId: string }> {
  const res = await fetch(`${modalUrl}/train`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(30_000),
  })
  if (!res.ok) {
    const text = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Failed to start Modal training: ${text}`)
  }
  return await res.json() as { jobId: string }
}

export async function getModalTrainingProgress(
  modalUrl: string,
  jobId: string,
): Promise<Record<string, unknown>> {
  const res = await fetch(`${modalUrl}/train/${jobId}/progress`, {
    signal: AbortSignal.timeout(10_000),
  })
  if (!res.ok) throw new Error(`Progress fetch failed: HTTP ${res.status}`)
  return await res.json() as Record<string, unknown>
}

export async function downloadTrainingOutput(
  modalUrl: string,
  jobId: string,
  outputName: string,
  toolId: string,
  executionId: string,
): Promise<{ localPath: string; apiPath: string; lorasCopyPath: string | null }> {
  const toolDir = join(API_OUTPUTS_DIR, toolId)
  mkdirSync(toolDir, { recursive: true })
  const destFilename = `${executionId.slice(0, 8)}_${outputName}.safetensors`
  const destPath = join(toolDir, destFilename)

  // Download directly from the Modal container via HTTP (file is in container memory)
  const res = await fetch(`${modalUrl}/download/${jobId}`, {
    signal: AbortSignal.timeout(300_000), // 5 min for large files
  })
  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Failed to download LoRA from Modal: ${errText}`)
  }
  const buffer = Buffer.from(await res.arrayBuffer())
  writeFileSync(destPath, buffer)

  let lorasCopyPath: string | null = null
  try {
    const comfyPath = getComfyManagedPath()
    if (comfyPath) {
      const lorasDir = join(comfyPath, 'models', 'loras')
      if (existsSync(lorasDir)) {
        lorasCopyPath = join(lorasDir, `${outputName}.safetensors`)
        copyFileSync(destPath, lorasCopyPath)
      }
    }
  } catch { /* non-fatal */ }

  return { localPath: destPath, apiPath: `/api/outputs/${toolId}/${destFilename}`, lorasCopyPath }
}

function runHelper(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn('python3', [HELPER_SCRIPT, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 300_000,
    })
    let out = ''
    proc.stdout.on('data', (d: Buffer) => { out += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0 && !out.trim()) reject(new Error(`modal-helper exited with code ${code}`))
      else resolve(out.trim())
    })
    proc.on('error', reject)
  })
}
