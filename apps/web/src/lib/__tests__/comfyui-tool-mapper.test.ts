import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock comfyui-client before importing
vi.mock('../comfyui-client', () => ({
  listWorkflows: vi.fn(),
  loadWorkflow: vi.fn(),
  saveWorkflow: vi.fn(),
  getObjectInfo: vi.fn(),
}))

vi.mock('../built-in-tools', () => ({
  BUILT_IN_TOOLS: [],
  BUILT_IN_WORKFLOWS: {},
}))

import { graphToApiFormat, resolveWidgetValues, discoverComfyUITools } from '../comfyui-tool-mapper'
import { listWorkflows, loadWorkflow, getObjectInfo } from '../comfyui-client'

// ── graphToApiFormat ─────────────────────────────────────────────────────────

describe('graphToApiFormat', () => {
  it('returns null for null input', () => {
    expect(graphToApiFormat(null)).toBeNull()
  })

  it('returns null for undefined input', () => {
    expect(graphToApiFormat(undefined)).toBeNull()
  })

  it('returns null for input without nodes array', () => {
    expect(graphToApiFormat({ foo: 'bar' })).toBeNull()
  })

  it('returns null when nodes is not an array', () => {
    expect(graphToApiFormat({ nodes: 'not-array' })).toBeNull()
  })

  it('converts a simple graph with no links', () => {
    const graph = {
      nodes: [
        { id: 1, type: 'EmptyLatentImage', inputs: [], widgets_values: [512, 512, 1] },
      ],
      links: [],
    }
    const result = graphToApiFormat(graph)
    expect(result).not.toBeNull()
    expect(result!['1']).toBeDefined()
    expect(result!['1'].class_type).toBe('EmptyLatentImage')
  })

  it('skips nodes without a type', () => {
    const graph = {
      nodes: [
        { id: 1, inputs: [] },
        { id: 2, type: 'KSampler', inputs: [] },
      ],
      links: [],
    }
    const result = graphToApiFormat(graph)
    expect(result!['1']).toBeUndefined()
    expect(result!['2']).toBeDefined()
  })

  it('wires connected inputs as [sourceNodeId, sourceOutputIndex]', () => {
    const graph = {
      nodes: [
        { id: 1, type: 'CheckpointLoaderSimple', inputs: [] },
        {
          id: 2,
          type: 'KSampler',
          inputs: [{ name: 'model', type: 'MODEL', link: 1 }],
        },
      ],
      links: [[1, 1, 0, 2, 0, 'MODEL']],
    }
    const result = graphToApiFormat(graph)
    expect(result!['2'].inputs.model).toEqual(['1', 0])
  })

  it('maps widget values when widget inputs are present', () => {
    const graph = {
      nodes: [
        {
          id: 1,
          type: 'CustomNode',
          inputs: [
            { name: 'text', type: 'STRING', link: null, widget: true },
            { name: 'num', type: 'INT', link: null, widget: true },
          ],
          widgets_values: ['hello', 42],
        },
      ],
      links: [],
    }
    const result = graphToApiFormat(graph)
    expect(result!['1'].inputs.text).toBe('hello')
    expect(result!['1'].inputs.num).toBe(42)
  })

  it('skips seed control sentinels when mapping widget values', () => {
    const graph = {
      nodes: [
        {
          id: 1,
          type: 'CustomSampler',
          inputs: [
            { name: 'seed', type: 'INT', link: null, widget: true },
            { name: 'steps', type: 'INT', link: null, widget: true },
          ],
          widgets_values: [42, 'randomize', 20],
        },
      ],
      links: [],
    }
    const result = graphToApiFormat(graph)
    expect(result!['1'].inputs.seed).toBe(42)
    expect(result!['1'].inputs.steps).toBe(20)
  })

  it('stores __widget_values__ fallback when no explicit widget inputs', () => {
    const graph = {
      nodes: [
        {
          id: 1,
          type: 'UnknownNode',
          inputs: [],
          widgets_values: ['val1', 'val2'],
        },
      ],
      links: [],
    }
    const result = graphToApiFormat(graph)
    expect(result!['1'].inputs.__widget_values__).toEqual(['val1', 'val2'])
  })

  it('does not overwrite linked inputs with widget values', () => {
    const graph = {
      nodes: [
        { id: 1, type: 'Source', inputs: [] },
        {
          id: 2,
          type: 'Target',
          inputs: [
            { name: 'input_a', type: 'STRING', link: 10, widget: true },
          ],
          widgets_values: ['fallback'],
        },
      ],
      links: [[10, 1, 0, 2, 0, 'STRING']],
    }
    const result = graphToApiFormat(graph)
    expect(result!['2'].inputs.input_a).toEqual(['1', 0])
  })

  it('handles graph with no links array', () => {
    const graph = {
      nodes: [
        { id: 1, type: 'SimpleNode', inputs: [] },
      ],
    }
    const result = graphToApiFormat(graph)
    expect(result).not.toBeNull()
    expect(result!['1'].class_type).toBe('SimpleNode')
  })

  it('handles multiple seed control values in sequence', () => {
    const graph = {
      nodes: [
        {
          id: 1,
          type: 'DoubleSeed',
          inputs: [
            { name: 'seed1', type: 'INT', link: null, widget: true },
            { name: 'seed2', type: 'INT', link: null, widget: true },
          ],
          widgets_values: [100, 'fixed', 200, 'increment'],
        },
      ],
      links: [],
    }
    const result = graphToApiFormat(graph)
    expect(result!['1'].inputs.seed1).toBe(100)
    expect(result!['1'].inputs.seed2).toBe(200)
  })

  it('handles empty widgets_values array', () => {
    const graph = {
      nodes: [
        {
          id: 1,
          type: 'NoWidgets',
          inputs: [
            { name: 'val', type: 'STRING', link: null, widget: true },
          ],
          widgets_values: [],
        },
      ],
      links: [],
    }
    const result = graphToApiFormat(graph)
    expect(result!['1'].inputs.val).toBeUndefined()
  })
})

// ── resolveWidgetValues ──────────────────────────────────────────────────────

describe('resolveWidgetValues', () => {
  it('resolves __widget_values__ using objectInfo', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'MyNode',
        inputs: { __widget_values__: ['hello', 42] },
      },
    }
    const objectInfo = {
      MyNode: {
        input: {
          required: {
            text: ['STRING'],
            count: ['INT'],
          },
        },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.text).toBe('hello')
    expect(apiFormat['1'].inputs.count).toBe(42)
    expect(apiFormat['1'].inputs.__widget_values__).toBeUndefined()
  })

  it('skips nodes without __widget_values__', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'MyNode',
        inputs: { text: 'already resolved' },
      },
    }
    const objectInfo = {
      MyNode: {
        input: { required: { text: ['STRING'] } },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.text).toBe('already resolved')
  })

  it('skips unknown node types', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'UnknownNode',
        inputs: { __widget_values__: ['hello'] },
      },
    }
    resolveWidgetValues(apiFormat, {})
    expect(apiFormat['1'].inputs.__widget_values__).toBeUndefined()
  })

  it('handles COMBO (array) type specs', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'ComboNode',
        inputs: { __widget_values__: ['option_b'] },
      },
    }
    const objectInfo = {
      ComboNode: {
        input: {
          required: {
            mode: [['option_a', 'option_b', 'option_c']],
          },
        },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.mode).toBe('option_b')
  })

  it('skips seed control values during resolution', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'SamplerNode',
        inputs: { __widget_values__: [12345, 'randomize', 20] },
      },
    }
    const objectInfo = {
      SamplerNode: {
        input: {
          required: {
            seed: ['INT'],
            steps: ['INT'],
          },
        },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.seed).toBe(12345)
    expect(apiFormat['1'].inputs.steps).toBe(20)
  })

  it('does not overwrite already-resolved inputs', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'MyNode',
        inputs: {
          text: 'already set',
          __widget_values__: ['overwrite_attempt', 42],
        },
      },
    }
    const objectInfo = {
      MyNode: {
        input: {
          required: {
            text: ['STRING'],
            count: ['INT'],
          },
        },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.text).toBe('already set')
    expect(apiFormat['1'].inputs.count).toBe(42)
  })

  it('handles optional inputs', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'OptNode',
        inputs: { __widget_values__: ['hello', 0.5] },
      },
    }
    const objectInfo = {
      OptNode: {
        input: {
          required: {
            text: ['STRING'],
          },
          optional: {
            strength: ['FLOAT'],
          },
        },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.text).toBe('hello')
    expect(apiFormat['1'].inputs.strength).toBe(0.5)
  })

  it('handles node with no input definitions', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'NoInputNode',
        inputs: { __widget_values__: ['ignored'] },
      },
    }
    const objectInfo = {
      NoInputNode: {},
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.__widget_values__).toBeUndefined()
  })

  it('skips non-widget types (MODEL, LATENT, etc.)', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'MixedNode',
        inputs: { __widget_values__: ['hello'] },
      },
    }
    const objectInfo = {
      MixedNode: {
        input: {
          required: {
            model: ['MODEL'],
            text: ['STRING'],
          },
        },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.text).toBe('hello')
    expect(apiFormat['1'].inputs.model).toBeUndefined()
  })

  it('handles BOOLEAN type', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'BoolNode',
        inputs: { __widget_values__: [true] },
      },
    }
    const objectInfo = {
      BoolNode: {
        input: {
          required: {
            enabled: ['BOOLEAN'],
          },
        },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.enabled).toBe(true)
  })

  it('handles seed control value that IS a valid combo option', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'ComboWithFixed',
        inputs: { __widget_values__: ['fixed'] },
      },
    }
    const objectInfo = {
      ComboWithFixed: {
        input: {
          required: {
            mode: [['fixed', 'random', 'sequential']],
          },
        },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    // 'fixed' should NOT be skipped because the combo includes it
    expect(apiFormat['1'].inputs.mode).toBe('fixed')
  })

  it('handles more widget values than widget names (extra values ignored)', () => {
    const apiFormat: Record<string, any> = {
      '1': {
        class_type: 'ShortNode',
        inputs: { __widget_values__: ['hello', 42, 'extra'] },
      },
    }
    const objectInfo = {
      ShortNode: {
        input: {
          required: {
            text: ['STRING'],
          },
        },
      },
    }
    resolveWidgetValues(apiFormat, objectInfo)
    expect(apiFormat['1'].inputs.text).toBe('hello')
  })
})

// ── discoverComfyUITools (covers mapWorkflowToTool, mapInputDef, humanize) ──

describe('discoverComfyUITools', () => {
  beforeEach(() => {
    vi.mocked(listWorkflows).mockReset()
    vi.mocked(loadWorkflow).mockReset()
    vi.mocked(getObjectInfo).mockReset()
  })

  const objectInfo = {
    KSampler: {
      input: {
        required: {
          model: ['MODEL'],
          positive: ['CONDITIONING'],
          negative: ['CONDITIONING'],
          latent_image: ['LATENT'],
          seed: ['INT', { min: 0, max: 2 ** 32 }],
          steps: ['INT', { min: 1, max: 150 }],
          cfg: ['FLOAT', { min: 0, max: 100, step: 0.1 }],
          sampler_name: [['euler', 'euler_ancestral', 'dpmpp_2m']],
          scheduler: [['normal', 'karras', 'sgm_uniform']],
          denoise: ['FLOAT', { min: 0, max: 1, step: 0.01 }],
        },
      },
    },
    CLIPTextEncode: {
      input: {
        required: {
          text: ['STRING', { multiline: true }],
          clip: ['CLIP'],
        },
      },
    },
    SaveImage: {
      input: {
        required: {
          images: ['IMAGE'],
          filename_prefix: ['STRING'],
        },
      },
    },
    EmptyLatentImage: {
      input: {
        required: {
          width: ['INT', { min: 16, max: 8192 }],
          height: ['INT', { min: 16, max: 8192 }],
          batch_size: ['INT', { min: 1, max: 64 }],
        },
      },
    },
    CheckpointLoaderSimple: {
      input: {
        required: {
          ckpt_name: [['v1-5.safetensors', 'sdxl.safetensors']],
        },
      },
    },
    LoadImage: {
      input: {
        required: {
          image: ['IMAGE'],
        },
      },
    },
  }

  it('discovers tools from API-format workflows', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['simple.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'hello', clip: ['2', 0] } },
      '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5.safetensors' } },
      '3': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'output' } },
    })

    const result = await discoverComfyUITools()
    expect(result.status).toBe('success')
    expect(result.tools.length).toBe(1)
    expect(result.tools[0].name).toBe('simple')
    expect(result.tools[0].workflow_id).toBe('comfyui:simple.json')
  })

  it('discovers inputs and outputs correctly', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['test.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'prompt', clip: ['3', 1] } },
      '2': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '3': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5.safetensors' } },
      '4': { class_type: 'SaveImage', inputs: { images: ['5', 0], filename_prefix: 'ComfyUI' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    expect(tool.outputs.length).toBeGreaterThan(0)
    expect(tool.inputs.length).toBeGreaterThan(0)
  })

  it('maps INT inputs correctly with number type', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['latent.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '2': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'output' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const widthInput = tool.inputs.find((i) => i.parameter_name.includes('width'))
    expect(widthInput).toBeDefined()
    expect(widthInput!.demo_type).toBe('number')
    expect(widthInput!.value_type).toBe('int')
  })

  it('maps STRING inputs correctly', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['text.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['2', 1] } },
      '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5.safetensors' } },
      '3': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const textInput = tool.inputs.find((i) => i.parameter_name.includes('text'))
    expect(textInput).toBeDefined()
    expect(textInput!.demo_type).toBe('textarea') // multiline: true
  })

  it('maps COMBO inputs correctly', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['combo.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5.safetensors' } },
      '2': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const combo = tool.inputs.find((i) => i.parameter_name.includes('ckpt_name'))
    expect(combo).toBeDefined()
    expect(combo!.demo_type).toBe('combo')
  })

  it('maps BOOLEAN inputs correctly', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['bool.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      BoolNode: {
        input: {
          required: { enabled: ['BOOLEAN'] },
        },
      },
      SaveImage: objectInfo.SaveImage,
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'BoolNode', inputs: { enabled: true } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const boolInput = tool.inputs.find((i) => i.parameter_name.includes('enabled'))
    expect(boolInput).toBeDefined()
    expect(boolInput!.demo_type).toBe('boolean')
    expect(boolInput!.value_type).toBe('boolean')
  })

  it('maps FILE_INPUT_TYPES (IMAGE, AUDIO, VIDEO) as file inputs', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['file.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      ...objectInfo,
      AudioLoader: {
        input: { required: { audio: ['AUDIO'] } },
      },
      VideoLoader: {
        input: { required: { video: ['VIDEO'] } },
      },
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'LoadImage', inputs: { image: 'test.png' } },
      '2': { class_type: 'AudioLoader', inputs: { audio: 'test.wav' } },
      '3': { class_type: 'VideoLoader', inputs: { video: 'test.mp4' } },
      '4': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const imageInput = tool.inputs.find((i) => i.parameter_name.includes('image'))
    expect(imageInput?.demo_type).toBe('image')
    expect(imageInput?.value_type).toBe('file')
    const audioInput = tool.inputs.find((i) => i.parameter_name.includes('audio'))
    expect(audioInput?.demo_type).toBe('audio')
    const videoInput = tool.inputs.find((i) => i.parameter_name.includes('video'))
    expect(videoInput?.demo_type).toBe('video')
  })

  it('detects 3D output nodes', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['3d.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      FSSave3D: { input: { required: {} } },
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'FSSave3D', inputs: {} },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    expect(tool.outputs[0].demo_type).toBe('3d')
  })

  it('detects audio output nodes', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['audio.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      FSSaveAudio: { input: { required: {} } },
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'FSSaveAudio', inputs: {} },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    expect(tool.outputs[0].demo_type).toBe('audio')
  })

  it('detects video output nodes', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['video.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      FSSaveVideo: { input: { required: {} } },
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'FSSaveVideo', inputs: {} },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    expect(tool.outputs[0].demo_type).toBe('video')
  })

  it('skips workflows that fail to parse', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.mocked(listWorkflows).mockResolvedValue(['bad.json', 'good.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow)
      .mockRejectedValueOnce(new Error('parse error'))
      .mockResolvedValueOnce({
        '1': { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'out' } },
      })

    const result = await discoverComfyUITools()
    expect(result.tools.length).toBe(1)
    warnSpy.mockRestore()
  })

  it('skips workflows with no inputs or outputs', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['empty.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: ['2', 0] } },
    })

    const result = await discoverComfyUITools()
    // CheckpointLoaderSimple with ckpt_name linked = no free inputs, no outputs
    expect(result.tools.length).toBe(0)
  })

  it('handles graph-format workflows', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['graph.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      nodes: [
        { id: 1, type: 'EmptyLatentImage', inputs: [], widgets_values: [512, 512, 1] },
        { id: 2, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE', link: 1 }], widgets_values: ['output'] },
      ],
      links: [[1, 3, 0, 2, 0, 'IMAGE']],
    })

    const result = await discoverComfyUITools()
    expect(result.tools.length).toBe(1)
  })

  it('returns default output when no output nodes found', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['no-output.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    expect(tool.outputs[0].label).toBe('Output')
    expect(tool.outputs[0].demo_type).toBe('image')
  })

  it('sets randomize=true for seed inputs', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['seed.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': {
        class_type: 'KSampler',
        inputs: {
          model: ['2', 0],
          positive: ['3', 0],
          negative: ['4', 0],
          latent_image: ['5', 0],
          seed: 42,
          steps: 20,
          cfg: 7,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 1.0,
        },
      },
      '6': { class_type: 'SaveImage', inputs: { images: ['7', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const seedInput = tool.inputs.find((i) => i.parameter_name.includes('seed'))
    expect(seedInput?.randomize).toBe(true)
  })

  it('skips linked inputs (not free)', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['linked.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'hello', clip: ['2', 1] } },
      '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5.safetensors' } },
      '3': { class_type: 'SaveImage', inputs: { images: ['4', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    // 'clip' is linked, should not appear as input
    const clipInput = tool.inputs.find((i) => i.parameter_name.includes('clip'))
    expect(clipInput).toBeUndefined()
  })

  it('returns correct total count', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['a.json', 'b.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    expect(result.total).toBe(result.tools.length)
  })

  it('handles null apiNodes from graphToApiFormat', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['invalid.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({ nodes: 'not-an-array' })

    const result = await discoverComfyUITools()
    expect(result.tools.length).toBe(0)
  })

  it('humanizes input labels (snake_case to Title Case)', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['label.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
      '2': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const batchInput = tool.inputs.find((i) => i.parameter_name.includes('batch_size'))
    expect(batchInput?.label).toBe('Batch size')
  })

  it('skips inputs with unknown type specs', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['unknown-type.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      WeirdNode: {
        input: {
          required: {
            custom: ['CUSTOM_TYPE'],
            text: ['STRING'],
          },
        },
      },
      SaveImage: objectInfo.SaveImage,
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'WeirdNode', inputs: { custom: 'something', text: 'hello' } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    // 'custom' with CUSTOM_TYPE should be skipped, 'text' should be kept
    const customInput = tool.inputs.find((i) => i.parameter_name.includes('custom'))
    expect(customInput).toBeUndefined()
    const textInput = tool.inputs.find((i) => i.parameter_name.includes('text'))
    expect(textInput).toBeDefined()
  })

  it('strips FS prefix from output labels', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['fs.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      FSSaveImage: { input: { required: {} } },
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'FSSaveImage', inputs: {} },
    })

    const result = await discoverComfyUITools()
    const output = result.tools[0].outputs[0]
    expect(output.label).not.toContain('FS')
  })

  it('handles MASK type as image file input', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['mask.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      MaskNode: {
        input: { required: { mask: ['MASK'] } },
      },
      SaveImage: objectInfo.SaveImage,
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'MaskNode', inputs: { mask: 'mask.png' } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const maskInput = tool.inputs.find((i) => i.parameter_name.includes('mask'))
    expect(maskInput?.demo_type).toBe('image')
    expect(maskInput?.value_type).toBe('file')
  })

  it('maps FLOAT inputs with step config', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['float.json'])
    vi.mocked(getObjectInfo).mockResolvedValue(objectInfo)
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': {
        class_type: 'KSampler',
        inputs: {
          model: ['10', 0],
          positive: ['11', 0],
          negative: ['12', 0],
          latent_image: ['13', 0],
          seed: 42,
          steps: 20,
          cfg: 7.5,
          sampler_name: 'euler',
          scheduler: 'normal',
          denoise: 0.8,
        },
      },
      '2': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const cfgInput = tool.inputs.find((i) => i.parameter_name.includes('cfg'))
    expect(cfgInput?.demo_type).toBe('number')
    expect(cfgInput?.value_type).toBe('float')
  })

  it('non-multiline STRING maps as string demo_type', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['string.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      ...objectInfo,
      SaveImage: {
        input: {
          required: {
            images: ['IMAGE'],
            filename_prefix: ['STRING'],
          },
        },
      },
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'SaveImage', inputs: { images: ['2', 0], filename_prefix: 'myprefix' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const prefixInput = tool.inputs.find((i) => i.parameter_name.includes('filename_prefix'))
    expect(prefixInput?.demo_type).toBe('string')
  })

  it('skips inputs where inputDef is not found in objectInfo', async () => {
    vi.mocked(listWorkflows).mockResolvedValue(['missing-def.json'])
    vi.mocked(getObjectInfo).mockResolvedValue({
      PartialNode: {
        input: {
          required: {
            known: ['STRING'],
          },
        },
      },
      SaveImage: objectInfo.SaveImage,
    })
    vi.mocked(loadWorkflow).mockResolvedValue({
      '1': { class_type: 'PartialNode', inputs: { known: 'hello', unknown_param: 42 } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
    })

    const result = await discoverComfyUITools()
    const tool = result.tools[0]
    const unknownInput = tool.inputs.find((i) => i.parameter_name.includes('unknown_param'))
    expect(unknownInput).toBeUndefined()
  })
})
