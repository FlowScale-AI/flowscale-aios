import type { ComfyUIWorkflow, WorkflowIO } from './types'

// Node types commonly used as user-facing inputs
const INPUT_NODE_TYPES = new Set([
  'CLIPTextEncode',
  'KSampler',
  'KSamplerAdvanced',
  'EmptyLatentImage',
  'LoadImage',
  'LoadImageMask'
])

// Node types commonly used as outputs
const OUTPUT_NODE_TYPES = new Set([
  'SaveImage',
  'PreviewImage',
  'SaveAnimatedWEBP',
  'SaveAnimatedPNG',
  'VHS_VideoCombine'
])

// Parameters that are typically user-facing
const USER_PARAMS: Record<string, string[]> = {
  CLIPTextEncode: ['text'],
  KSampler: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
  KSamplerAdvanced: ['noise_seed', 'steps', 'cfg', 'sampler_name', 'scheduler'],
  EmptyLatentImage: ['width', 'height', 'batch_size'],
  LoadImage: ['image']
}

export function analyzeWorkflow(workflow: ComfyUIWorkflow): WorkflowIO[] {
  const ios: WorkflowIO[] = []

  for (const [nodeId, node] of Object.entries(workflow)) {
    const nodeTitle = (node._meta?.title as string) || node.class_type

    // Detect inputs
    if (INPUT_NODE_TYPES.has(node.class_type)) {
      const relevantParams = USER_PARAMS[node.class_type] || Object.keys(node.inputs)

      for (const paramName of relevantParams) {
        const value = node.inputs[paramName]
        // Skip link references (arrays like [nodeId, outputIndex])
        if (Array.isArray(value)) continue

        ios.push({
          nodeId,
          nodeType: node.class_type,
          nodeTitle,
          paramName,
          paramType: inferParamType(paramName, value),
          defaultValue: value,
          isInput: true
        })
      }
    }

    // Detect outputs
    if (OUTPUT_NODE_TYPES.has(node.class_type)) {
      ios.push({
        nodeId,
        nodeType: node.class_type,
        nodeTitle,
        paramName: 'images',
        paramType: 'image',
        isInput: false
      })
    }
  }

  return ios
}

function inferParamType(
  name: string,
  value: unknown
): 'string' | 'number' | 'boolean' | 'image' | 'select' {
  if (name === 'image' || name === 'images') return 'image'
  if (typeof value === 'number') return 'number'
  if (typeof value === 'boolean') return 'boolean'
  if (
    name === 'sampler_name' ||
    name === 'scheduler' ||
    name === 'ckpt_name' ||
    name === 'vae_name'
  ) {
    return 'select'
  }
  return 'string'
}

export function isValidComfyWorkflow(json: unknown): json is ComfyUIWorkflow {
  if (typeof json !== 'object' || json === null || Array.isArray(json)) return false
  const entries = Object.entries(json as Record<string, unknown>)
  if (entries.length === 0) return false
  return entries.every(([, node]) => {
    return (
      typeof node === 'object' &&
      node !== null &&
      'class_type' in node &&
      'inputs' in node &&
      typeof (node as { class_type: unknown }).class_type === 'string'
    )
  })
}
