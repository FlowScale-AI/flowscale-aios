export type ComfyUIWorkflow = Record<string, {
  class_type: string
  inputs: Record<string, unknown>
  _meta?: Record<string, unknown>
}>

export interface WorkflowIO {
  nodeId: string
  nodeType: string
  nodeTitle: string
  paramName: string
  paramType: 'string' | 'number' | 'boolean' | 'image' | 'select'
  defaultValue?: unknown
  options?: string[]
  isInput: boolean
}
