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

// Widget value order for graph-format nodes.
// null = widget present in widgets_values but not a named user param (e.g. control_after_generate).
// Only widget (non-linked) inputs are listed here; linked inputs come from the links array.
const GRAPH_WIDGET_PARAMS: Record<string, Array<string | null>> = {
  // Sampling
  KSampler: ['seed', null /* control_after_generate */, 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
  KSamplerAdvanced: ['add_noise', 'noise_seed', null /* control_after_generate */, 'steps', 'cfg', 'sampler_name', 'scheduler', 'start_at_step', 'end_at_step', 'return_with_leftover_noise'],

  // Text / CLIP
  CLIPTextEncode: ['text'],
  CLIPSetLastLayer: ['stop_at_clip_layer'],

  // Loaders
  CheckpointLoaderSimple: ['ckpt_name'],
  CheckpointSave: ['filename_prefix'],
  VAELoader: ['vae_name'],
  LoraLoader: ['lora_name', 'strength_model', 'strength_clip'],
  LoraLoaderModelOnly: ['lora_name', 'strength_model'],
  HypernetworkLoader: ['hypernetwork_name', 'strength'],
  UpscaleModelLoader: ['model_name'],
  CLIPVisionLoader: ['clip_name'],
  StyleModelLoader: ['style_model_name'],
  ControlNetLoader: ['control_net_name'],
  GLIGENLoader: ['gligen_name'],

  // VAE
  VAEEncode: [],
  VAEDecode: [],
  VAEEncodeForInpaint: ['grow_mask_by'],
  VAEDecodeTiled: ['tile_size', 'overlap', 'temporal_size', 'temporal_overlap'],
  VAEEncodeTiled: ['tile_size', 'overlap', 'temporal_size', 'temporal_overlap'],

  // Latent
  EmptyLatentImage: ['width', 'height', 'batch_size'],
  LatentRotate: ['rotation'],
  LatentFlip: ['flip_method'],
  LatentComposite: ['x', 'y', 'feather'],
  LatentCrop: ['width', 'height', 'x', 'y'],
  SetLatentNoiseMask: [],

  // Image
  LoadImage: ['image'],
  LoadImageMask: ['image', 'channel'],
  SaveImage: ['filename_prefix'],
  PreviewImage: [],
  ImageScale: ['upscale_method', 'width', 'height', 'crop'],
  ImageUpscaleWithModel: [],

  // ControlNet
  ControlNetApply: ['strength'],
  ControlNetApplyAdvanced: ['strength', 'start_percent', 'end_percent'],

  // CLIP Vision / Style
  CLIPVisionEncode: ['crop'],
  StyleModelApply: ['strength', 'strength_type'],
  unCLIPConditioning: ['strength', 'noise_augmentation'],

  // GLIGEN
  GLIGENTextBoxApply: ['text', 'width', 'height', 'x', 'y'],

  // Inpaint
  InpaintModelConditioning: ['noise_mask'],

  // Model patches
  ModelMergeSimple: ['ratio'],
  ModelMergeBlocks: ['input', 'middle', 'out'],
  CLIPMergeSimple: ['ratio'],
  TomePatchModel: ['ratio'],
  SelfAttentionGuidance: ['scale', 'blur_sigma'],
  FreeU: ['b1', 'b2', 's1', 's2'],
  FreeU_V2: ['b1', 'b2', 's1', 's2'],
  PatchModelAddDownscale: ['block_number', 'downscale_factor', 'start_percent', 'end_percent', 'downscale_after_skip', 'downscale_method', 'upscale_method'],
}

interface GraphNodeInput {
  name: string
  type: string
  link: number | null
}

interface GraphNode {
  id: number
  type: string
  inputs?: GraphNodeInput[]
  widgets_values?: unknown[]
  properties?: Record<string, unknown>
}

interface GraphFormat {
  nodes: GraphNode[]
  // Each link: [link_id, from_node_id, from_output_slot, to_node_id, to_input_slot, type]
  links?: number[][]
}

function isGraphFormat(json: unknown): json is GraphFormat {
  return (
    typeof json === 'object' &&
    json !== null &&
    !Array.isArray(json) &&
    'nodes' in json &&
    Array.isArray((json as GraphFormat).nodes)
  )
}

function isApiFormat(json: unknown): boolean {
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

// UI-only node types that have no ComfyUI backend — skip during conversion
const UI_ONLY_NODES = new Set(['Note', 'PrimitiveNode', 'Reroute'])

/** Convert graph-format workflow to API format */
function graphToApi(graph: GraphFormat): ComfyUIWorkflow {
  // Build link map: link_id -> [from_node_id_str, from_output_slot]
  const linkMap = new Map<number, [string, number]>()
  for (const link of graph.links ?? []) {
    const [linkId, fromNodeId, fromSlot] = link
    linkMap.set(linkId, [String(fromNodeId), fromSlot])
  }

  const api: ComfyUIWorkflow = {}
  for (const node of graph.nodes) {
    if (UI_ONLY_NODES.has(node.type)) continue

    const inputs: Record<string, unknown> = {}

    // Wire linked inputs (connections from other nodes)
    for (const inp of node.inputs ?? []) {
      if (inp.link != null && linkMap.has(inp.link)) {
        inputs[inp.name] = linkMap.get(inp.link)
      }
    }

    // Wire widget inputs (non-linked values stored in widgets_values)
    const widgetParams = GRAPH_WIDGET_PARAMS[node.type]
    if (widgetParams && node.widgets_values) {
      widgetParams.forEach((name, i) => {
        if (name !== null && i < node.widgets_values!.length) {
          inputs[name] = node.widgets_values![i]
        }
      })
    }

    api[String(node.id)] = {
      class_type: node.type,
      inputs,
      _meta: { title: node.type }
    }
  }
  return api
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
  return isApiFormat(json) || isGraphFormat(json)
}

/** Normalize any valid ComfyUI workflow format into API format for analysis */
export function normalizeWorkflow(json: ComfyUIWorkflow | GraphFormat): ComfyUIWorkflow {
  if (isGraphFormat(json)) return graphToApi(json)
  return json as ComfyUIWorkflow
}
