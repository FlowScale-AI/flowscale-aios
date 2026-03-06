import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock comfyui-client
const mockListWorkflows = vi.fn()
const mockLoadWorkflow = vi.fn()
const mockSaveWorkflow = vi.fn()
const mockGetObjectInfo = vi.fn()

vi.mock('../comfyui-client', () => ({
  listWorkflows: (...args: any[]) => mockListWorkflows(...args),
  loadWorkflow: (...args: any[]) => mockLoadWorkflow(...args),
  saveWorkflow: (...args: any[]) => mockSaveWorkflow(...args),
  getObjectInfo: (...args: any[]) => mockGetObjectInfo(...args),
}))

// Mock built-in-tools WITH actual data to cover the sync path
vi.mock('../built-in-tools', () => ({
  BUILT_IN_TOOLS: [
    {
      project_id: 'built-in',
      project_name: 'FlowScale',
      workflow_id: 'comfyui:builtin.json',
      name: 'Built-in Tool',
      description: 'A built-in tool',
      inputs: [{ path: '1.inputs.text', label: 'Text', parameter_name: '1::text', demo_type: 'string', category: 'test', randomize: false, value_type: 'string' }],
      outputs: [{ label: 'Output', demo_type: 'image', parameter_name: '2::SaveImage', category: 'SaveImage' }],
      is_manual: false,
      id: 'comfyui:builtin.json',
    },
  ],
  BUILT_IN_WORKFLOWS: {
    'builtin.json': { '1': { class_type: 'TestNode', inputs: { text: 'hello' } } },
    'new_builtin.json': { '1': { class_type: 'TestNode2', inputs: { text: 'world' } } },
  },
}))

import { discoverComfyUITools } from '../comfyui-tool-mapper'

describe('discoverComfyUITools - built-in sync', () => {
  const objectInfo = {
    TestNode: {
      input: { required: { text: ['STRING'] } },
    },
    SaveImage: {
      input: { required: { images: ['IMAGE'], filename_prefix: ['STRING'] } },
    },
  }

  beforeEach(() => {
    mockListWorkflows.mockReset()
    mockLoadWorkflow.mockReset()
    mockSaveWorkflow.mockReset()
    mockGetObjectInfo.mockReset()
  })

  it('syncs missing built-in workflows to ComfyUI', async () => {
    // 'builtin.json' already exists, 'new_builtin.json' does not
    mockListWorkflows.mockResolvedValue(['builtin.json'])
    mockGetObjectInfo.mockResolvedValue(objectInfo)
    mockLoadWorkflow.mockResolvedValue({
      '1': { class_type: 'TestNode', inputs: { text: 'hello' } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
    })
    mockSaveWorkflow.mockResolvedValue(undefined)

    await discoverComfyUITools()

    // Should sync new_builtin.json but not builtin.json
    expect(mockSaveWorkflow).toHaveBeenCalledTimes(1)
    expect(mockSaveWorkflow).toHaveBeenCalledWith(
      'new_builtin.json',
      expect.any(Object),
      undefined,
    )
  })

  it('handles sync failure gracefully', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockListWorkflows.mockResolvedValue([])
    mockGetObjectInfo.mockResolvedValue(objectInfo)
    mockSaveWorkflow.mockRejectedValue(new Error('save failed'))

    await discoverComfyUITools()

    expect(warnSpy).toHaveBeenCalled()
    warnSpy.mockRestore()
  })

  it('overrides auto-discovered tool with built-in definition', async () => {
    mockListWorkflows.mockResolvedValue(['builtin.json'])
    mockGetObjectInfo.mockResolvedValue(objectInfo)
    mockLoadWorkflow.mockResolvedValue({
      '1': { class_type: 'TestNode', inputs: { text: 'hello' } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
    })
    mockSaveWorkflow.mockResolvedValue(undefined)

    const result = await discoverComfyUITools()

    const builtInTool = result.tools.find((t) => t.workflow_id === 'comfyui:builtin.json')
    expect(builtInTool).toBeDefined()
    expect(builtInTool!.name).toBe('Built-in Tool') // from BUILT_IN_TOOLS, not auto-discovered
  })

  it('appends built-in tools not matching any discovered workflow', async () => {
    mockListWorkflows.mockResolvedValue([])
    mockGetObjectInfo.mockResolvedValue(objectInfo)
    mockSaveWorkflow.mockResolvedValue(undefined)

    const result = await discoverComfyUITools()

    const builtInTool = result.tools.find((t) => t.workflow_id === 'comfyui:builtin.json')
    expect(builtInTool).toBeDefined()
  })
})
