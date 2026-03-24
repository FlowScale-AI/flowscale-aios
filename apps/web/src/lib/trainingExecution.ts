import { getDb } from '@/lib/db'
import { executions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { copyFileSync, mkdirSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'
import { getPlugin } from './toolPlugins'
import { getComfyManagedPath } from './providerSettings'

const API_OUTPUTS_DIR = join(homedir(), '.flowscale', 'aios-outputs')

/**
 * Start a training job on the plugin server.
 * Returns immediately with the jobId — progress is tracked via SSE.
 */
export async function runTraining(
  executionId: string,
  pluginId: string,
  config: Record<string, unknown>,
): Promise<{ jobId: string }> {
  const plugin = getPlugin(pluginId)
  if (!plugin || plugin.server.type !== 'training') {
    throw new Error(`Plugin "${pluginId}" is not a training plugin`)
  }

  const endpoint = plugin.server.trainEndpoint ?? '/train'
  const port = plugin.server.port

  const res = await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config),
    signal: AbortSignal.timeout(30_000),
  })

  if (!res.ok) {
    const errText = await res.text().catch(() => `HTTP ${res.status}`)
    throw new Error(`Failed to start training: ${errText}`)
  }

  const data = await res.json() as { jobId: string }
  return data
}

/**
 * File-based finalization for training outputs.
 * Copies .safetensors from outputPath to AIOS outputs + ComfyUI loras/.
 */
export async function finalizeTrainingExecution(
  executionId: string,
  toolId: string,
  outputPath: string,
  outputName: string,
): Promise<void> {
  const db = getDb()

  // 1. Copy to AIOS outputs
  const toolDir = join(API_OUTPUTS_DIR, toolId)
  mkdirSync(toolDir, { recursive: true })
  const destFilename = `${executionId.slice(0, 8)}_${outputName}.safetensors`
  const destPath = join(toolDir, destFilename)
  copyFileSync(outputPath, destPath)

  // 2. Copy to ComfyUI loras folder (best-effort)
  let lorasCopyPath: string | null = null
  try {
    const comfyPath = getComfyManagedPath()
    if (comfyPath) {
      const lorasDir = join(comfyPath, 'models', 'loras')
      if (existsSync(lorasDir)) {
        const lorasDest = join(lorasDir, `${outputName}.safetensors`)
        copyFileSync(outputPath, lorasDest)
        lorasCopyPath = lorasDest
      }
    }
  } catch { /* non-fatal */ }

  // 3. Update execution record
  const outputItems = [{
    kind: 'file',
    filename: destFilename,
    path: `/api/outputs/${toolId}/${destFilename}`,
    lorasCopyPath,
  }]

  await db.update(executions).set({
    status: 'completed',
    outputsJson: JSON.stringify(outputItems),
    completedAt: Date.now(),
  }).where(eq(executions.id, executionId))
}

/**
 * Cancel a training job — calls the plugin's cancel endpoint.
 */
export async function cancelTraining(
  pluginId: string,
  jobId: string,
): Promise<void> {
  const plugin = getPlugin(pluginId)
  if (!plugin) throw new Error(`Plugin "${pluginId}" not found`)

  const rawEndpoint = plugin.server.cancelEndpoint ?? `/train/${jobId}/cancel`
  const endpoint = rawEndpoint.replace('{jobId}', jobId)
  const port = plugin.server.port

  await fetch(`http://127.0.0.1:${port}${endpoint}`, {
    method: 'POST',
    signal: AbortSignal.timeout(10_000),
  })
}
