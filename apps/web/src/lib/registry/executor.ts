import type { ComfyUIWorkflow, WorkflowIO } from '@flowscale/workflow'
import type { RegistryTool } from './types'
import { queuePrompt, getHistory, getOutputUrl } from '@/lib/comfyui-client'
import { v4 as uuidv4 } from 'uuid'

export interface RegistryExecuteOptions {
  /** ComfyUI port to run against */
  comfyPort: number
  /** User-supplied input values keyed by `${nodeId}.${paramName}` */
  inputs: Record<string, unknown>
  /** Abort signal to cancel polling */
  signal?: AbortSignal
  /** Called periodically with a 0–1 progress value */
  onProgress?: (progress: number) => void
}

export interface RegistryExecuteResult {
  outputs: Array<{
    nodeId: string
    outputIndex: number
    url: string
    type: 'image' | 'video' | 'audio'
  }>
  promptId: string
}

export async function executeRegistryTool(
  tool: RegistryTool,
  options: RegistryExecuteOptions,
): Promise<RegistryExecuteResult> {
  const { comfyPort, inputs, signal, onProgress } = options

  // Clone the workflow and inject user inputs
  const workflow = injectInputs(tool.workflowJson, tool.schema, inputs)

  const clientId = uuidv4()
  const baseUrl = `http://127.0.0.1:${comfyPort}`
  const promptId = await queuePrompt(workflow, clientId, baseUrl)

  // Poll history until complete
  const outputs = await pollUntilComplete(promptId, comfyPort, baseUrl, signal, onProgress)

  return { outputs, promptId }
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function injectInputs(
  workflowJson: ComfyUIWorkflow,
  schema: WorkflowIO[],
  userInputs: Record<string, unknown>,
): ComfyUIWorkflow {
  // Deep clone
  const workflow = JSON.parse(JSON.stringify(workflowJson)) as ComfyUIWorkflow

  for (const field of schema) {
    if (!field.isInput) continue
    const key = `${field.nodeId}.${field.paramName}`
    const value = key in userInputs ? userInputs[key] : field.defaultValue
    if (value === undefined) continue

    const node = workflow[field.nodeId]
    if (node) {
      node.inputs[field.paramName] = value
    }
  }

  return workflow
}

async function pollUntilComplete(
  promptId: string,
  comfyPort: number,
  baseUrl: string,
  signal?: AbortSignal,
  onProgress?: (progress: number) => void,
): Promise<RegistryExecuteResult['outputs']> {
  const maxWait = 300_000 // 5 minutes
  const interval = 1_000
  const started = Date.now()

  while (Date.now() - started < maxWait) {
    if (signal?.aborted) {
      throw new Error('Execution cancelled')
    }

    await sleep(interval)

    const history = await getHistory(promptId, baseUrl)
    const entry = history[promptId]
    if (!entry) continue

    const status = entry.status as Record<string, unknown> | undefined
    if (status?.completed) {
      // Parse outputs
      const rawOutputs = (entry.outputs ?? {}) as Record<string, unknown>
      const outputs: RegistryExecuteResult['outputs'] = []

      for (const [nodeId, nodeOutput] of Object.entries(rawOutputs)) {
        const images = (nodeOutput as Record<string, unknown>)?.images as
          | Array<{ filename: string; subfolder: string; type: string }>
          | undefined
        if (images) {
          images.forEach((img, idx) => {
            outputs.push({
              nodeId,
              outputIndex: idx,
              url: getOutputUrl(img.filename, img.subfolder, img.type, baseUrl),
              type: guessMediaType(img.filename),
            })
          })
        }
      }

      onProgress?.(1)
      return outputs
    }

    // Estimate progress from queue position if available
    const queueRemaining = (status as Record<string, unknown> | undefined)?.exec_info as
      | Record<string, number>
      | undefined
    if (queueRemaining?.queue_remaining !== undefined) {
      onProgress?.(Math.max(0, 0.1))
    }
  }

  throw new Error(`Execution timed out after ${maxWait / 1000}s`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function guessMediaType(filename: string): 'image' | 'video' | 'audio' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  if (['mp4', 'webm', 'gif', 'mov'].includes(ext)) return 'video'
  if (['mp3', 'wav', 'ogg', 'flac'].includes(ext)) return 'audio'
  return 'image'
}
