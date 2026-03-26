import { spawn } from 'child_process'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync, copyFileSync, mkdirSync } from 'fs'
import { getDatasetDir, getDatasetSyncStatus, markDatasetSynced } from './training'
import { getComfyManagedPath } from './providerSettings'

const HELPER_SCRIPT = join(process.cwd(), 'scripts', 'modal-helper.py')
const API_OUTPUTS_DIR = join(homedir(), '.flowscale', 'aios-outputs')
const DATASETS_VOLUME = 'flowscale-training-datasets'
const OUTPUTS_VOLUME = 'flowscale-training-outputs'

// Path to the trainer plugin directory (contains modal_app.py)
const TRAINER_PLUGIN_DIR = join(process.cwd(), '..', '..', 'plugins', 'flux-lora-trainer')

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

export interface TrainingProgress {
  step: number
  totalSteps: number
  pct: number
  message: string
}

export interface TrainingResult {
  success: boolean
  status?: string
  outputVolumePath?: string
  sampleVolumePath?: string
  error?: string
}

export interface TrainingHandle {
  /** Resolves when training completes or fails. */
  result: Promise<TrainingResult>
  /** Kill the subprocess tree — Modal will terminate the remote container. */
  cancel: () => void
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

export function parseProgressLine(line: string): { type: 'progress'; data: TrainingProgress } | { type: 'result'; data: Record<string, unknown> } | null {
  if (line.startsWith('PROGRESS:')) {
    try {
      return { type: 'progress', data: JSON.parse(line.slice('PROGRESS:'.length)) as TrainingProgress }
    } catch { return null }
  }
  if (line.startsWith('RESULT:')) {
    try {
      return { type: 'result', data: JSON.parse(line.slice('RESULT:'.length)) as Record<string, unknown> }
    } catch { return null }
  }
  return null
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

/**
 * Run Modal training via `modal run` (ephemeral).
 *
 * Spawns `modal-helper.py run-training`, streams progress via callback.
 * Returns a handle with a `result` promise and a `cancel()` method.
 */
export function runModalTraining(
  payload: TrainingPayload & { jobId: string },
  gpu: string,
  onProgress: (progress: TrainingProgress) => void,
): TrainingHandle {
  const configJson = JSON.stringify(payload)
  const args = ['run-training', TRAINER_PLUGIN_DIR, configJson, gpu]

  const proc = spawn('python3', [HELPER_SCRIPT, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 7_500_000, // slightly above Modal's 7200s timeout
  })

  const result = new Promise<TrainingResult>((resolve, reject) => {
    let lineBuf = ''
    let lastJsonLine = ''  // last non-protocol line that could be _json_out() result

    proc.stdout.on('data', (chunk: Buffer) => {
      const text = chunk.toString()
      const lines = (lineBuf + text).split('\n')
      lineBuf = lines.pop() ?? ''

      for (const raw of lines) {
        const line = raw.trim()
        if (!line) continue
        const parsed = parseProgressLine(line)
        if (parsed?.type === 'progress') {
          onProgress(parsed.data)
        } else if (!parsed) {
          // Non-protocol line — could be the final _json_out() JSON
          lastJsonLine = line
        }
      }
    })

    let stderr = ''
    proc.stderr.on('data', (d: Buffer) => { stderr += d.toString() })

    proc.on('close', (code) => {
      // Process any remaining buffered content
      const trailing = lineBuf.trim()
      if (trailing) {
        const parsed = parseProgressLine(trailing)
        if (parsed?.type === 'progress') {
          onProgress(parsed.data)
        } else if (!parsed) {
          lastJsonLine = trailing
        }
      }

      // The final JSON line from modal-helper's _json_out()
      let resultData: TrainingResult | null = null
      if (lastJsonLine) {
        try {
          resultData = JSON.parse(lastJsonLine) as TrainingResult
        } catch {
          // Could not parse result
        }
      }

      if (resultData) {
        resolve(resultData)
      } else if (code !== 0) {
        reject(new Error(stderr.trim() || `modal-helper exited with code ${code}`))
      } else {
        reject(new Error('No result received from training'))
      }
    })

    proc.on('error', reject)
  })

  return {
    result,
    cancel: () => { proc.kill('SIGTERM') },
  }
}

/**
 * Download trained LoRA from Modal Volume and save locally.
 */
export async function downloadTrainingOutput(
  volumePath: string,
  outputName: string,
  toolId: string,
  executionId: string,
): Promise<{ localPath: string; apiPath: string; lorasCopyPath: string | null }> {
  const toolDir = join(API_OUTPUTS_DIR, toolId)
  mkdirSync(toolDir, { recursive: true })
  const destFilename = `${executionId.slice(0, 8)}_${outputName}.safetensors`
  const destPath = join(toolDir, destFilename)

  // Download from Modal Volume
  const args = ['download-training-output', OUTPUTS_VOLUME, volumePath, destPath]
  const result = await runHelper(args)
  const parsed = JSON.parse(result)
  if (!parsed.success) throw new Error(parsed.error || 'Failed to download from Volume')

  // Copy to ComfyUI loras dir if available
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

/**
 * Download sample image from Modal Volume.
 */
export async function downloadSampleImage(
  volumePath: string,
  toolId: string,
  executionId: string,
): Promise<string | null> {
  try {
    const toolDir = join(API_OUTPUTS_DIR, toolId)
    mkdirSync(toolDir, { recursive: true })
    const ext = volumePath.endsWith('.png') ? 'png' : 'jpg'
    const destFilename = `${executionId.slice(0, 8)}_sample.${ext}`
    const destPath = join(toolDir, destFilename)

    const args = ['download-training-output', OUTPUTS_VOLUME, volumePath, destPath]
    const result = await runHelper(args)
    const parsed = JSON.parse(result)
    if (!parsed.success) return null

    return `/api/outputs/${toolId}/${destFilename}`
  } catch {
    return null // non-fatal
  }
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
