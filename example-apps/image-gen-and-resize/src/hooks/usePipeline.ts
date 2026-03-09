import { useState } from 'react'
import { apiClient } from '../api/client'
import type { ToolDefinition, ToolOutputItem, WorkflowIO } from '../types'

export type StepStatus = 'idle' | 'running' | 'completed' | 'error'

export interface PipelineState {
  generateStatus: StepStatus
  resizeStatus: StepStatus
  generatedOutputs: ToolOutputItem[]
  finalOutputs: ToolOutputItem[]
  error: string | null
}

const IMAGE_NODE_TYPES = ['LoadImage', 'FSLoadImage', 'FSLoadAudio', 'VHS_LoadVideo', 'LoadImageMask']

function getInputKey(field: WorkflowIO): string {
  return `${field.nodeId}__${field.paramName}`
}

function parseSchema(tool: ToolDefinition): WorkflowIO[] {
  return JSON.parse(tool.schemaJson) as WorkflowIO[]
}

function findPromptInput(tool: ToolDefinition): WorkflowIO | null {
  const fields = parseSchema(tool).filter((f) => f.isInput && f.enabled !== false)
  // Prefer a field named "prompt" or "text", fall back to first string field
  return (
    fields.find((f) => f.paramType === 'string' && /prompt|text/i.test(f.paramName)) ??
    fields.find((f) => f.paramType === 'string') ??
    null
  )
}

function findImageInput(tool: ToolDefinition): WorkflowIO | null {
  const fields = parseSchema(tool).filter((f) => f.isInput && f.enabled !== false)
  return (
    fields.find((f) => f.paramType === 'image') ??
    fields.find((f) => IMAGE_NODE_TYPES.includes(f.nodeType)) ??
    null
  )
}

function findNumericInputs(tool: ToolDefinition, names: string[]): Record<string, WorkflowIO> {
  const fields = parseSchema(tool).filter((f) => f.isInput && f.paramType === 'number' && f.enabled !== false)
  const result: Record<string, WorkflowIO> = {}
  for (const field of fields) {
    for (const name of names) {
      if (field.paramName.toLowerCase().includes(name)) {
        result[name] = field
        break
      }
    }
  }
  return result
}

async function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => resolve(e.target!.result as string)
    reader.onerror = reject
    reader.readAsDataURL(blob)
  })
}

export function usePipeline(genTool: ToolDefinition | null, resizeTool: ToolDefinition | null) {
  const [state, setState] = useState<PipelineState>({
    generateStatus: 'idle',
    resizeStatus: 'idle',
    generatedOutputs: [],
    finalOutputs: [],
    error: null,
  })

  function reset() {
    setState({
      generateStatus: 'idle',
      resizeStatus: 'idle',
      generatedOutputs: [],
      finalOutputs: [],
      error: null,
    })
  }

  async function run(
    prompt: string,
    resizeOverrides: Record<string, unknown> = {},
  ) {
    if (!genTool || !resizeTool) return

    setState({
      generateStatus: 'running',
      resizeStatus: 'idle',
      generatedOutputs: [],
      finalOutputs: [],
      error: null,
    })

    try {
      // ── Step 1: Generate image ──────────────────────────────────────────
      const promptField = findPromptInput(genTool)
      const genInputs: Record<string, unknown> = {}
      if (promptField) genInputs[getInputKey(promptField)] = prompt

      const genResult = await apiClient.runTool(genTool.id, genInputs)
      const imageOutput = genResult.outputs.find((o) => o.kind === 'image')
      if (!imageOutput) throw new Error('Generation tool produced no image output.')

      setState((prev) => ({
        ...prev,
        generateStatus: 'completed',
        generatedOutputs: genResult.outputs,
        resizeStatus: 'running',
      }))

      // ── Step 2: Resize image ────────────────────────────────────────────
      const imageField = findImageInput(resizeTool)
      if (!imageField) throw new Error('Resize tool has no image input field.')

      // Fetch the generated image and prepare it for the resize tool
      const resp = await fetch(imageOutput.path, { credentials: 'include' })
      if (!resp.ok) throw new Error(`Failed to fetch generated image: ${resp.statusText}`)
      const blob = await resp.blob()

      let imageValue: string
      if (resizeTool.comfyPort) {
        // ComfyUI-engine: upload file to ComfyUI input dir
        const file = new File([blob], imageOutput.filename, { type: blob.type || 'image/png' })
        imageValue = await apiClient.uploadImage(resizeTool.comfyPort, file)
      } else {
        // API-engine: pass base64 data URL
        imageValue = await blobToBase64(blob)
      }

      const resizeInputs: Record<string, unknown> = {
        [getInputKey(imageField)]: imageValue,
        ...resizeOverrides,
      }

      const resizeResult = await apiClient.runTool(resizeTool.id, resizeInputs)

      setState((prev) => ({
        ...prev,
        resizeStatus: 'completed',
        finalOutputs: resizeResult.outputs,
      }))
    } catch (err) {
      const msg = (err as Error).message
      setState((prev) => ({
        ...prev,
        generateStatus: prev.generateStatus === 'running' ? 'error' : prev.generateStatus,
        resizeStatus: prev.resizeStatus === 'running' ? 'error' : prev.resizeStatus,
        error: msg,
      }))
    }
  }

  // Expose schema helpers so the UI can render resize-specific inputs
  function getResizeNumericFields() {
    if (!resizeTool) return {}
    return findNumericInputs(resizeTool, ['width', 'height', 'scale'])
  }

  return { state, run, reset, getResizeNumericFields }
}
