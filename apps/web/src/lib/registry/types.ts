import type { ComfyUIWorkflow, WorkflowIO } from '@flowscale/workflow'

export interface RegistryModelRequirement {
  /** ComfyUI model type folder, e.g. 'checkpoints', 'loras', 'controlnet' */
  folder: string
  /** Expected filename (may include wildcards with * glob syntax) */
  filename: string
  /** Human-readable label shown to users */
  label: string
  /** Download URL hint (optional) */
  downloadUrl?: string
}

export interface RegistryTool {
  id: string
  name: string
  description: string
  category: 'generation' | 'enhancement' | 'editing' | 'video' | 'utility'
  tags: string[]
  version: string
  /** Models required on the ComfyUI instance */
  requiredModels: RegistryModelRequirement[]
  /** Pre-computed input/output schema (no live ComfyUI needed) */
  schema: WorkflowIO[]
  /** Default ComfyUI workflow in API format */
  workflowJson: ComfyUIWorkflow
}

export interface ModelCheckResult {
  toolId: string
  ready: boolean
  missing: RegistryModelRequirement[]
  present: RegistryModelRequirement[]
}
