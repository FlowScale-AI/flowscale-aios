export interface WorkflowIO {
  nodeId: string
  nodeType: string
  nodeTitle: string
  paramName: string
  paramType: 'string' | 'number' | 'boolean' | 'image' | 'select'
  defaultValue?: unknown
  options?: string[]
  isInput: boolean
  enabled?: boolean
}

export interface ToolDefinition {
  id: string
  name: string
  description?: string
  engine: string
  schemaJson: string
  comfyPort?: number
  status: string
  createdAt: number
  deployedAt?: number
}

export interface ToolOutputItem {
  kind: 'image' | 'video' | 'audio' | 'file'
  filename: string
  subfolder: string
  path: string
}

export interface ToolRunResult {
  executionId: string
  toolId: string
  status: 'completed'
  outputs: ToolOutputItem[]
}

export interface CurrentUser {
  id: string
  username: string
  role: string
}
