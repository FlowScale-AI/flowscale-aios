import type { ComfyUIWorkflow, WorkflowIO } from './types'

// ---------------------------------------------------------------------------
// /object_info types — mirrors ComfyUI's GET /object_info response shape
// ---------------------------------------------------------------------------

/** First element is "INT" | "FLOAT" | "STRING" | "BOOLEAN", or an array of
 *  option strings for COMBO inputs. */
type ObjInfoInputType = string | string[]

/** [type, options?] tuple returned per input by /object_info */
type ObjInfoInputSpec = [ObjInfoInputType, Record<string, unknown>?]

export interface ObjectInfoNodeDef {
  input?: {
    required?: Record<string, ObjInfoInputSpec>
    optional?: Record<string, ObjInfoInputSpec>
  }
  input_order?: {
    required?: string[]
    optional?: string[]
  }
}

/** The full /object_info response: { NodeType: NodeDef, ... } */
export type ObjectInfoMap = Record<string, ObjectInfoNodeDef>

// ---------------------------------------------------------------------------

/** Returns true if the input spec represents a widget (primitive value) rather
 *  than a node connection link. */
function isWidgetInputSpec(spec: ObjInfoInputSpec): boolean {
  const type = spec[0]
  if (Array.isArray(type)) return true // COMBO dropdown (old format: options array)
  if (type === 'COMBO') return true    // COMBO dropdown (new format: "COMBO" string + options in spec[1])
  return type === 'INT' || type === 'FLOAT' || type === 'STRING' || type === 'BOOLEAN'
}

/**
 * Build the widget-param name list for a node type using live /object_info
 * data.  Returns null when the node type isn't present in the map.
 *
 * Rules:
 *  - Iterate inputs in input_order (required then optional).
 *  - Skip link inputs (non-primitive types like MODEL, LATENT, …).
 *  - After each INT input whose options include `control_after_generate: true`,
 *    insert a null placeholder for the extra "control_after_generate" combo
 *    widget that the ComfyUI frontend appends to widgets_values.
 */
function buildWidgetParamsFromInfo(
  nodeType: string,
  info: ObjectInfoMap
): Array<string | null> | null {
  const nodeDef = info[nodeType]
  if (!nodeDef?.input) return null

  const required = nodeDef.input.required ?? {}
  const optional = nodeDef.input.optional ?? {}
  const allInputs: Record<string, ObjInfoInputSpec> = { ...required, ...optional }

  const requiredOrder = nodeDef.input_order?.required ?? Object.keys(required)
  const optionalOrder = nodeDef.input_order?.optional ?? Object.keys(optional)
  const inputOrder = [...requiredOrder, ...optionalOrder]

  const params: Array<string | null> = []

  for (const inputName of inputOrder) {
    const spec = allInputs[inputName]
    if (!spec || !isWidgetInputSpec(spec)) continue

    params.push(inputName)

    // INT inputs with control_after_generate get a null placeholder for the
    // extra combo widget the ComfyUI frontend injects into widgets_values.
    const opts = spec[1]
    if (spec[0] === 'INT' && opts?.control_after_generate) {
      params.push(null)
    }
  }

  return params.length > 0 ? params : null
}

// ---------------------------------------------------------------------------

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
  // ComfyUI built-ins — Image
  'SaveImage',
  'PreviewImage',
  'SaveAnimatedWEBP',
  'SaveAnimatedPNG',
  // ComfyUI built-ins — Video
  'VHS_VideoCombine',
  // ComfyUI built-ins — Audio
  'SaveAudio',
  'PreviewAudio',

  // FlowScale nodes
  'FSSaveImage',
  'FSSaveVideo',
  'FSSaveAudio',
  'FSSaveText',
  'FSSaveInteger',
  'FSSave3D',
  'FSHunyuan3DGenerate',
  'UploadModelToPublicS3',
  'UploadModelToPrivateS3',
  'UploadImageToS3',
  'UploadMediaToS3FromLink',
  'UploadTextToS3',
  'SaveModelToFlowscaleVolume',

  // Other common 3D save nodes
  'Save3D',
  'TripoSGSave',
  'MeshSave',
])

// Returns true for any node whose class_type looks like a save/output node
// (heuristic for custom nodes not in the static set above)
function looksLikeOutputNode(classType: string): boolean {
  return /Save3D|Save.*3[Dd]|3[Dd].*Save|SaveMesh|SaveGLB|SaveGLTF|SaveOBJ|SaveFBX/i.test(classType)
}

// For known node types: explicit ordered list of user-facing params to expose.
// Unknown nodes fall back to Object.keys(node.inputs) — all non-link values.
// This list is intentionally minimal; objectInfoMap covers everything else automatically.
const USER_PARAMS: Record<string, string[]> = {
  CLIPTextEncode: ['text'],
  KSampler: ['seed', 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise'],
  KSamplerAdvanced: ['noise_seed', 'steps', 'cfg', 'sampler_name', 'scheduler'],
  EmptyLatentImage: ['width', 'height', 'batch_size'],
  LoadImage: ['image'],
  // FlowScale loader nodes — expose only the file/value input, not the display label
  FSLoad3D: ['model_file'],
  FSLoadImage: ['image'],
  FSLoadVideo: ['video', 'skip_first_frames', 'select_every_nth'],
  FSLoadAudio: ['audio'],
  FSLoadText: ['default_value'],
  FSLoadInteger: ['default_value'],
  FSLoadLoRA: ['default_lora_name', 'lora_url'],
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

  // Modern / SD3 / Flux nodes (fallback; objectInfoMap takes priority when ComfyUI is running)
  UNETLoader: ['unet_name', 'weight_dtype'],
  CLIPLoader: ['clip_name', 'type', 'weight_dtype'],
  EmptySD3LatentImage: ['width', 'height', 'batch_size'],
  ModelSamplingAuraFlow: ['shift'],
  ModelSamplingSD3: ['shift'],
  ModelSamplingFlux: ['max_shift', 'base_shift'],

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

// UI-only node types that have no ComfyUI backend — skip during conversion & queuing
const UI_ONLY_NODES = new Set(['Note', 'PrimitiveNode', 'Reroute', 'MarkdownNote'])

/** Convert graph-format workflow to API format.
 *  Pass objectInfoMap (from ComfyUI GET /object_info) for dynamic widget-param
 *  resolution; falls back to the static GRAPH_WIDGET_PARAMS table otherwise. */
function graphToApi(graph: GraphFormat, objectInfoMap?: ObjectInfoMap): ComfyUIWorkflow {
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

    // Wire widget inputs: prefer live /object_info map, fall back to static table
    const widgetParams =
      (objectInfoMap && buildWidgetParamsFromInfo(node.type, objectInfoMap)) ??
      GRAPH_WIDGET_PARAMS[node.type]
    if (widgetParams && node.widgets_values) {
      widgetParams.forEach((name, i) => {
        // Don't overwrite a value already set by link wiring
        if (name !== null && !(name in inputs) && i < node.widgets_values!.length) {
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

function inferOutputParamType(classType: string): 'image' | 'string' | 'select' | 'number' | 'boolean' {
  if (['FSSaveText', 'FSSaveInteger'].includes(classType)) return 'string'
  if (['FSSaveAudio', 'SaveAudio', 'PreviewAudio'].includes(classType)) return 'string'
  if (['FSSave3D', 'FSHunyuan3DGenerate', 'Save3D', 'TripoSGSave', 'MeshSave'].includes(classType) || /Save.*3[Dd]|3[Dd].*Save/i.test(classType)) return 'string'
  if (['FSSaveVideo', 'VHS_VideoCombine'].includes(classType)) return 'string'
  return 'image'
}

export function analyzeWorkflow(workflow: ComfyUIWorkflow): WorkflowIO[] {
  const ios: WorkflowIO[] = []

  for (const [nodeId, node] of Object.entries(workflow)) {
    const nodeTitle = (node._meta?.title as string) || node.class_type

    // Detect outputs
    if (OUTPUT_NODE_TYPES.has(node.class_type) || looksLikeOutputNode(node.class_type)) {
      ios.push({
        nodeId,
        nodeType: node.class_type,
        nodeTitle,
        paramName: 'output',
        paramType: inferOutputParamType(node.class_type),
        isInput: false
      })
      continue
    }

    // Detect inputs: include ALL non-output nodes that have widget (non-link) inputs.
    // Use USER_PARAMS for known nodes to get a sensible ordered subset;
    // fall back to all non-link inputs for unknown nodes.
    const paramNames = USER_PARAMS[node.class_type] ?? Object.keys(node.inputs)

    for (const paramName of paramNames) {
      const value = node.inputs[paramName]
      if (value === undefined) continue
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

  return ios
}

const PRIMITIVE_OUTPUT_TYPES = new Set(['STRING', 'INT', 'FLOAT', 'BOOLEAN'])

/**
 * Detect custom "source" nodes in a graph-format workflow that feed primitive
 * values (STRING/INT/FLOAT/BOOLEAN) into downstream nodes.  These are nodes
 * like WAS "Text Multiline" that are not in INPUT_NODE_TYPES but still act as
 * user-facing inputs.
 *
 * A node qualifies as a source node when:
 *  - It has no linked inputs (all data comes from widget values)
 *  - At least one of its outputs is connected to another node
 *  - Its connected output types include at least one primitive type
 *  - It has at least one widget value
 *  - It is not already handled by analyzeWorkflow (not in INPUT/OUTPUT/UI sets)
 */
export function analyzeGraphSourceNodes(
  workflow: ComfyUIWorkflow | GraphFormat,
  objectInfoMap?: ObjectInfoMap
): WorkflowIO[] {
  if (!isGraphFormat(workflow)) return []

  const graph = workflow

  // nodeId → set of output types (from links array element [5])
  const nodeOutputTypes = new Map<number, Set<string>>()
  for (const link of graph.links ?? []) {
    const fromNodeId = link[1]
    const linkType = String(link[5] ?? '')
    if (!nodeOutputTypes.has(fromNodeId)) nodeOutputTypes.set(fromNodeId, new Set())
    nodeOutputTypes.get(fromNodeId)!.add(linkType)
  }

  const ios: WorkflowIO[] = []

  for (const node of graph.nodes) {
    // Skip node types already handled elsewhere
    if (INPUT_NODE_TYPES.has(node.type)) continue
    if (OUTPUT_NODE_TYPES.has(node.type)) continue
    if (UI_ONLY_NODES.has(node.type)) continue

    // Must have no linked inputs (pure widget-value source)
    const hasLinkedInput = (node.inputs ?? []).some(inp => inp.link != null)
    if (hasLinkedInput) continue

    // Must have at least one widget value
    if (!node.widgets_values?.length) continue

    // Must output at least one primitive type
    const outTypes = nodeOutputTypes.get(node.id) ?? new Set<string>()
    const primitiveOuts = [...outTypes].filter(t => PRIMITIVE_OUTPUT_TYPES.has(t))
    if (primitiveOuts.length === 0) continue

    // Resolve widget param names: prefer live objectInfo, then fallback
    const widgetParams = objectInfoMap
      ? buildWidgetParamsFromInfo(node.type, objectInfoMap)
      : null

    if (widgetParams) {
      widgetParams.forEach((name, i) => {
        if (name !== null && i < node.widgets_values!.length) {
          const value = node.widgets_values![i]
          ios.push({
            nodeId: String(node.id),
            nodeType: node.type,
            nodeTitle: node.type,
            paramName: name,
            paramType: inferParamType(name, value),
            defaultValue: value,
            isInput: true,
          })
        }
      })
    } else {
      // Fallback: one entry per primitive output type, derive param name from type
      for (const outType of primitiveOuts) {
        const paramName = outType === 'STRING' ? 'text' : 'value'
        const value = node.widgets_values[0]
        ios.push({
          nodeId: String(node.id),
          nodeType: node.type,
          nodeTitle: node.type,
          paramName,
          paramType: inferParamType(paramName, value),
          defaultValue: value,
          isInput: true,
        })
      }
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

/** Normalize any valid ComfyUI workflow format into API format for analysis.
 *  Optionally pass objectInfoMap (from ComfyUI GET /object_info) to resolve
 *  widget params for custom nodes beyond the built-in static table. */
export function normalizeWorkflow(
  json: ComfyUIWorkflow | GraphFormat,
  objectInfoMap?: ObjectInfoMap
): ComfyUIWorkflow {
  const api = isGraphFormat(json) ? graphToApi(json, objectInfoMap) : { ...json as ComfyUIWorkflow }
  // Strip UI-only nodes that have no ComfyUI backend (e.g. MarkdownNote, Note)
  for (const nodeId of Object.keys(api)) {
    const node = api[nodeId] as { class_type?: string }
    if (node.class_type && UI_ONLY_NODES.has(node.class_type)) {
      delete api[nodeId]
    }
  }
  return api
}
