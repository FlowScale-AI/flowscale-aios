import { describe, it, expect } from 'vitest'
import {
  isValidComfyWorkflow,
  normalizeWorkflow,
  analyzeWorkflow,
  analyzeGraphSourceNodes,
} from './analyzer'
import type { ComfyUIWorkflow } from './types'
import type { ObjectInfoMap } from './analyzer'

// ── Fixtures ─────────────────────────────────────────────────────────────────

const apiWorkflow: ComfyUIWorkflow = {
  '1': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'a photo of a cat', clip: ['2', 0] },
    _meta: { title: 'Positive Prompt' },
  },
  '2': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'v1-5.safetensors' },
  },
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 42,
      steps: 20,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1.0,
      model: ['2', 0],
      positive: ['1', 0],
      negative: ['4', 0],
      latent_image: ['5', 0],
    },
  },
  '4': {
    class_type: 'CLIPTextEncode',
    inputs: { text: 'bad quality', clip: ['2', 1] },
    _meta: { title: 'Negative Prompt' },
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: 512, height: 512, batch_size: 1 },
  },
  '6': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'output', images: ['7', 0] },
    _meta: { title: 'Save Image' },
  },
  '7': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['2', 2] },
  },
}

const graphWorkflow = {
  nodes: [
    {
      id: 1,
      type: 'CLIPTextEncode',
      inputs: [{ name: 'clip', type: 'CLIP', link: 10 }],
      widgets_values: ['a photo of a cat'],
    },
    {
      id: 2,
      type: 'CheckpointLoaderSimple',
      inputs: [],
      widgets_values: ['v1-5.safetensors'],
    },
    {
      id: 3,
      type: 'KSampler',
      inputs: [
        { name: 'model', type: 'MODEL', link: 1 },
        { name: 'positive', type: 'CONDITIONING', link: 2 },
        { name: 'negative', type: 'CONDITIONING', link: 3 },
        { name: 'latent_image', type: 'LATENT', link: 4 },
      ],
      widgets_values: [42, 'randomize', 20, 7, 'euler', 'normal', 1.0],
    },
    {
      id: 4,
      type: 'EmptyLatentImage',
      inputs: [],
      widgets_values: [512, 512, 1],
    },
    {
      id: 5,
      type: 'SaveImage',
      inputs: [{ name: 'images', type: 'IMAGE', link: 5 }],
      widgets_values: ['output'],
    },
  ],
  links: [
    [1, 2, 0, 3, 0, 'MODEL'],
    [2, 1, 0, 3, 1, 'CONDITIONING'],
    [3, 1, 0, 3, 2, 'CONDITIONING'],
    [4, 4, 0, 3, 3, 'LATENT'],
    [5, 7, 0, 5, 0, 'IMAGE'],
    [10, 2, 1, 1, 0, 'CLIP'],
  ],
}

// ── isValidComfyWorkflow ─────────────────────────────────────────────────────

describe('isValidComfyWorkflow', () => {
  it('recognises a valid API-format workflow', () => {
    expect(isValidComfyWorkflow(apiWorkflow)).toBe(true)
  })

  it('recognises a valid graph-format workflow', () => {
    expect(isValidComfyWorkflow(graphWorkflow)).toBe(true)
  })

  it('rejects null', () => {
    expect(isValidComfyWorkflow(null)).toBe(false)
  })

  it('rejects undefined', () => {
    expect(isValidComfyWorkflow(undefined)).toBe(false)
  })

  it('rejects arrays', () => {
    expect(isValidComfyWorkflow([1, 2, 3])).toBe(false)
  })

  it('rejects primitive strings', () => {
    expect(isValidComfyWorkflow('hello')).toBe(false)
  })

  it('rejects numbers', () => {
    expect(isValidComfyWorkflow(42)).toBe(false)
  })

  it('rejects an empty object (no entries)', () => {
    expect(isValidComfyWorkflow({})).toBe(false)
  })

  it('rejects an object without class_type', () => {
    expect(isValidComfyWorkflow({ '1': { inputs: {} } })).toBe(false)
  })

  it('rejects an object without inputs', () => {
    expect(isValidComfyWorkflow({ '1': { class_type: 'Foo' } })).toBe(false)
  })

  it('accepts a graph with an empty nodes array', () => {
    expect(isValidComfyWorkflow({ nodes: [] })).toBe(true)
  })

  it('rejects a graph where nodes is not an array', () => {
    expect(isValidComfyWorkflow({ nodes: 'not-array' })).toBe(false)
  })

  it('accepts API format with a single valid node', () => {
    expect(isValidComfyWorkflow({ '1': { class_type: 'Foo', inputs: {} } })).toBe(true)
  })

  it('rejects if any entry fails API format check', () => {
    expect(
      isValidComfyWorkflow({
        '1': { class_type: 'Foo', inputs: {} },
        '2': { bad: true },
      }),
    ).toBe(false)
  })
})

// ── normalizeWorkflow ────────────────────────────────────────────────────────

describe('normalizeWorkflow', () => {
  it('returns API format as-is (shallow copy)', () => {
    const result = normalizeWorkflow(apiWorkflow)
    expect(result).toEqual(apiWorkflow)
    expect(result).not.toBe(apiWorkflow)
  })

  it('strips UI-only nodes from API format', () => {
    const withNote: ComfyUIWorkflow = {
      ...apiWorkflow,
      '99': { class_type: 'Note', inputs: {} },
      '100': { class_type: 'PrimitiveNode', inputs: {} },
      '101': { class_type: 'Reroute', inputs: {} },
      '102': { class_type: 'MarkdownNote', inputs: {} },
    }
    const result = normalizeWorkflow(withNote)
    expect(result['99']).toBeUndefined()
    expect(result['100']).toBeUndefined()
    expect(result['101']).toBeUndefined()
    expect(result['102']).toBeUndefined()
    expect(result['1']).toBeDefined()
  })

  it('converts graph format to API format', () => {
    const result = normalizeWorkflow(graphWorkflow as any)
    // Should have all non-UI nodes
    expect(result['1']).toBeDefined()
    expect(result['1'].class_type).toBe('CLIPTextEncode')
    expect(result['2']).toBeDefined()
    expect(result['3']).toBeDefined()
    expect(result['5']).toBeDefined()
  })

  it('graph conversion wires linked inputs as [nodeId, slotIndex]', () => {
    const result = normalizeWorkflow(graphWorkflow as any)
    // KSampler node 3 should have model linked to node 2
    expect(result['3'].inputs.model).toEqual(['2', 0])
  })

  it('graph conversion assigns widget values using static GRAPH_WIDGET_PARAMS', () => {
    const result = normalizeWorkflow(graphWorkflow as any)
    // KSampler: widgets_values = [42, 'randomize', 20, 7, 'euler', 'normal', 1.0]
    // GRAPH_WIDGET_PARAMS.KSampler = ['seed', null, 'steps', 'cfg', 'sampler_name', 'scheduler', 'denoise']
    expect(result['3'].inputs.seed).toBe(42)
    expect(result['3'].inputs.steps).toBe(20)
    expect(result['3'].inputs.cfg).toBe(7)
    expect(result['3'].inputs.sampler_name).toBe('euler')
    expect(result['3'].inputs.scheduler).toBe('normal')
    expect(result['3'].inputs.denoise).toBe(1.0)
  })

  it('graph conversion skips UI-only nodes', () => {
    const graphWithNote = {
      nodes: [
        ...graphWorkflow.nodes,
        { id: 99, type: 'Note', inputs: [], widgets_values: ['my note'] },
      ],
      links: graphWorkflow.links,
    }
    const result = normalizeWorkflow(graphWithNote as any)
    expect(result['99']).toBeUndefined()
  })

  it('uses objectInfoMap when provided for graph conversion', () => {
    const objectInfoMap: ObjectInfoMap = {
      CLIPTextEncode: {
        input: {
          required: {
            text: ['STRING', { multiline: true }],
            clip: ['CLIP'],
          },
        },
        input_order: {
          required: ['text', 'clip'],
        },
      },
    }
    const simpleGraph = {
      nodes: [
        {
          id: 1,
          type: 'CLIPTextEncode',
          inputs: [{ name: 'clip', type: 'CLIP', link: 10 }],
          widgets_values: ['hello world'],
        },
        { id: 2, type: 'CheckpointLoaderSimple', inputs: [], widgets_values: ['model.safetensors'] },
      ],
      links: [[10, 2, 1, 1, 0, 'CLIP']],
    }
    const result = normalizeWorkflow(simpleGraph as any, objectInfoMap)
    expect(result['1'].inputs.text).toBe('hello world')
  })
})

// ── analyzeWorkflow ──────────────────────────────────────────────────────────

describe('analyzeWorkflow', () => {
  it('detects SaveImage as an output node', () => {
    const ios = analyzeWorkflow(apiWorkflow)
    const outputs = ios.filter((io) => !io.isInput)
    expect(outputs.length).toBe(1)
    expect(outputs[0].nodeType).toBe('SaveImage')
    expect(outputs[0].paramName).toBe('output')
    expect(outputs[0].paramType).toBe('image')
  })

  it('detects CLIPTextEncode inputs with correct param type', () => {
    const ios = analyzeWorkflow(apiWorkflow)
    const clipInputs = ios.filter((io) => io.nodeType === 'CLIPTextEncode' && io.isInput)
    expect(clipInputs.length).toBe(2)
    expect(clipInputs[0].paramName).toBe('text')
    expect(clipInputs[0].paramType).toBe('string')
  })

  it('detects KSampler inputs with correct param types', () => {
    const ios = analyzeWorkflow(apiWorkflow)
    const ksInputs = ios.filter((io) => io.nodeType === 'KSampler' && io.isInput)
    const paramMap = Object.fromEntries(ksInputs.map((io) => [io.paramName, io]))
    expect(paramMap.seed.paramType).toBe('number')
    expect(paramMap.seed.defaultValue).toBe(42)
    expect(paramMap.steps.paramType).toBe('number')
    expect(paramMap.cfg.paramType).toBe('number')
    expect(paramMap.sampler_name.paramType).toBe('select')
    expect(paramMap.scheduler.paramType).toBe('select')
    expect(paramMap.denoise.paramType).toBe('number')
  })

  it('detects EmptyLatentImage inputs', () => {
    const ios = analyzeWorkflow(apiWorkflow)
    const latentInputs = ios.filter((io) => io.nodeType === 'EmptyLatentImage' && io.isInput)
    expect(latentInputs.length).toBe(3)
    expect(latentInputs.map((i) => i.paramName).sort()).toEqual(['batch_size', 'height', 'width'])
  })

  it('skips link references (array values)', () => {
    const ios = analyzeWorkflow(apiWorkflow)
    // CLIPTextEncode has 'clip' input which is a link — should not appear
    const clipLinks = ios.filter((io) => io.paramName === 'clip')
    expect(clipLinks.length).toBe(0)
  })

  it('uses node _meta title when available', () => {
    const ios = analyzeWorkflow(apiWorkflow)
    const positive = ios.find((io) => io.nodeId === '1')
    expect(positive?.nodeTitle).toBe('Positive Prompt')
  })

  it('falls back to class_type when _meta is missing', () => {
    const ios = analyzeWorkflow(apiWorkflow)
    const checkpoint = ios.find((io) => io.nodeId === '2')
    expect(checkpoint?.nodeTitle).toBe('CheckpointLoaderSimple')
  })

  it('handles unknown node types by using all non-link keys', () => {
    const workflow: ComfyUIWorkflow = {
      '1': {
        class_type: 'MyCustomNode',
        inputs: {
          text_input: 'hello',
          number_input: 42,
          linked: ['2', 0],
        },
      },
    }
    const ios = analyzeWorkflow(workflow)
    expect(ios.length).toBe(2)
    expect(ios.find((io) => io.paramName === 'text_input')).toBeDefined()
    expect(ios.find((io) => io.paramName === 'number_input')).toBeDefined()
    expect(ios.find((io) => io.paramName === 'linked')).toBeUndefined()
  })

  it('detects PreviewImage as output', () => {
    const workflow: ComfyUIWorkflow = {
      '1': { class_type: 'PreviewImage', inputs: { images: ['2', 0] } },
    }
    const ios = analyzeWorkflow(workflow)
    expect(ios.length).toBe(1)
    expect(ios[0].isInput).toBe(false)
    expect(ios[0].paramType).toBe('image')
  })

  it('detects FlowScale output nodes', () => {
    const fsOutputTypes = [
      'FSSaveImage', 'FSSaveVideo', 'FSSaveAudio', 'FSSaveText', 'FSSave3D',
    ]
    for (const classType of fsOutputTypes) {
      const workflow: ComfyUIWorkflow = {
        '1': { class_type: classType, inputs: {} },
      }
      const ios = analyzeWorkflow(workflow)
      expect(ios.length).toBe(1)
      expect(ios[0].isInput).toBe(false)
    }
  })

  it('infers correct output type for text/audio/3D/video nodes', () => {
    const cases: Array<[string, string]> = [
      ['FSSaveText', 'string'],
      ['FSSaveAudio', 'string'],
      ['FSSave3D', 'string'],
      ['FSSaveVideo', 'string'],
      ['SaveImage', 'image'],
      ['PreviewImage', 'image'],
      ['FSHunyuan3DGenerate', 'string'],
      ['VHS_VideoCombine', 'string'],
      ['SaveVideo', 'string'],
      ['SaveAudio', 'string'],
      ['PreviewAudio', 'string'],
    ]
    for (const [classType, expected] of cases) {
      const workflow: ComfyUIWorkflow = {
        '1': { class_type: classType, inputs: {} },
      }
      const ios = analyzeWorkflow(workflow)
      expect(ios[0].paramType).toBe(expected)
    }
  })

  it('detects heuristic 3D output nodes via regex', () => {
    const heuristicTypes = ['MySave3DModel', 'Custom3DSave', 'SaveMeshNode']
    for (const classType of heuristicTypes) {
      const workflow: ComfyUIWorkflow = {
        '1': { class_type: classType, inputs: {} },
      }
      const ios = analyzeWorkflow(workflow)
      expect(ios[0]?.isInput).toBe(false)
    }
  })

  it('infers image param type for "image" param name', () => {
    const workflow: ComfyUIWorkflow = {
      '1': { class_type: 'LoadImage', inputs: { image: 'photo.png' } },
    }
    const ios = analyzeWorkflow(workflow)
    const img = ios.find((io) => io.paramName === 'image')
    expect(img?.paramType).toBe('image')
  })

  it('infers boolean param type', () => {
    const workflow: ComfyUIWorkflow = {
      '1': { class_type: 'CustomNode', inputs: { enabled: true } },
    }
    const ios = analyzeWorkflow(workflow)
    expect(ios[0].paramType).toBe('boolean')
  })

  it('infers select type for known select params', () => {
    const selectParams = ['sampler_name', 'scheduler', 'ckpt_name', 'vae_name']
    for (const param of selectParams) {
      const workflow: ComfyUIWorkflow = {
        '1': { class_type: 'CustomNode', inputs: { [param]: 'some_value' } },
      }
      const ios = analyzeWorkflow(workflow)
      expect(ios[0].paramType).toBe('select')
    }
  })

  it('returns empty array for workflow with no inputs or outputs', () => {
    const workflow: ComfyUIWorkflow = {
      '1': { class_type: 'VAEDecode', inputs: { samples: ['2', 0], vae: ['3', 0] } },
    }
    const ios = analyzeWorkflow(workflow)
    expect(ios.length).toBe(0)
  })

  it('handles FSLoadImage input params correctly', () => {
    const workflow: ComfyUIWorkflow = {
      '1': { class_type: 'FSLoadImage', inputs: { image: 'photo.png' } },
    }
    const ios = analyzeWorkflow(workflow)
    expect(ios.length).toBe(1)
    expect(ios[0].paramName).toBe('image')
    expect(ios[0].paramType).toBe('image')
  })

  it('detects UploadModelToPublicS3 as output', () => {
    const workflow: ComfyUIWorkflow = {
      '1': { class_type: 'UploadModelToPublicS3', inputs: {} },
    }
    const ios = analyzeWorkflow(workflow)
    expect(ios[0].isInput).toBe(false)
  })

  it('handles SaveAnimatedWEBP and SaveAnimatedPNG as outputs', () => {
    for (const ct of ['SaveAnimatedWEBP', 'SaveAnimatedPNG']) {
      const workflow: ComfyUIWorkflow = {
        '1': { class_type: ct, inputs: {} },
      }
      const ios = analyzeWorkflow(workflow)
      expect(ios[0].isInput).toBe(false)
      expect(ios[0].paramType).toBe('image')
    }
  })

  it('detects SaveVideo as an output node with string paramType', () => {
    const workflow: ComfyUIWorkflow = {
      '1': { class_type: 'SaveVideo', inputs: {} },
    }
    const ios = analyzeWorkflow(workflow)
    expect(ios.length).toBe(1)
    expect(ios[0].isInput).toBe(false)
    expect(ios[0].paramType).toBe('string')
  })

  it('handles FSSaveInteger as output with string paramType', () => {
    const workflow: ComfyUIWorkflow = {
      '1': { class_type: 'FSSaveInteger', inputs: {} },
    }
    const ios = analyzeWorkflow(workflow)
    expect(ios[0].paramType).toBe('string')
  })

  it('detects TripoSGSave and MeshSave as outputs', () => {
    for (const ct of ['TripoSGSave', 'MeshSave', 'Save3D']) {
      const workflow: ComfyUIWorkflow = {
        '1': { class_type: ct, inputs: {} },
      }
      const ios = analyzeWorkflow(workflow)
      expect(ios[0].isInput).toBe(false)
    }
  })

  it('handles images param name as image type', () => {
    const workflow: ComfyUIWorkflow = {
      '1': { class_type: 'CustomNode', inputs: { images: 'file.png' } },
    }
    const ios = analyzeWorkflow(workflow)
    expect(ios[0].paramType).toBe('image')
  })
})

// ── analyzeGraphSourceNodes ──────────────────────────────────────────────────

describe('analyzeGraphSourceNodes', () => {
  it('returns empty array for API-format input', () => {
    const result = analyzeGraphSourceNodes(apiWorkflow)
    expect(result).toEqual([])
  })

  it('detects a source node with STRING output', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'WAS_Text_Multiline',
          inputs: [],
          widgets_values: ['Hello world'],
        },
        {
          id: 1,
          type: 'CLIPTextEncode',
          inputs: [
            { name: 'text', type: 'STRING', link: 100 },
            { name: 'clip', type: 'CLIP', link: 101 },
          ],
        },
      ],
      links: [
        [100, 10, 0, 1, 0, 'STRING'],
        [101, 2, 0, 1, 1, 'CLIP'],
      ],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result.length).toBe(1)
    expect(result[0].nodeType).toBe('WAS_Text_Multiline')
    expect(result[0].paramName).toBe('text')
    expect(result[0].defaultValue).toBe('Hello world')
  })

  it('skips nodes that are INPUT_NODE_TYPES', () => {
    const graph = {
      nodes: [
        {
          id: 1,
          type: 'CLIPTextEncode',
          inputs: [],
          widgets_values: ['test'],
        },
      ],
      links: [[1, 1, 0, 2, 0, 'STRING']],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result).toEqual([])
  })

  it('skips nodes that are OUTPUT_NODE_TYPES', () => {
    const graph = {
      nodes: [
        {
          id: 1,
          type: 'SaveImage',
          inputs: [],
          widgets_values: ['prefix'],
        },
      ],
      links: [[1, 1, 0, 2, 0, 'STRING']],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result).toEqual([])
  })

  it('skips nodes that are UI_ONLY_NODES', () => {
    const graph = {
      nodes: [
        { id: 1, type: 'Note', inputs: [], widgets_values: ['note text'] },
      ],
      links: [[1, 1, 0, 2, 0, 'STRING']],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result).toEqual([])
  })

  it('skips nodes with linked inputs', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'CustomTextNode',
          inputs: [{ name: 'input', type: 'STRING', link: 50 }],
          widgets_values: ['some text'],
        },
      ],
      links: [
        [50, 5, 0, 10, 0, 'STRING'],
        [51, 10, 0, 20, 0, 'STRING'],
      ],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result).toEqual([])
  })

  it('skips nodes without widget values', () => {
    const graph = {
      nodes: [
        { id: 10, type: 'EmptySource', inputs: [] },
      ],
      links: [[1, 10, 0, 2, 0, 'STRING']],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result).toEqual([])
  })

  it('skips nodes without primitive output types', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'CustomLoader',
          inputs: [],
          widgets_values: ['model.safetensors'],
        },
      ],
      links: [[1, 10, 0, 2, 0, 'MODEL']],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result).toEqual([])
  })

  it('detects INT output as "value" param', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'IntegerSource',
          inputs: [],
          widgets_values: [42],
        },
      ],
      links: [[1, 10, 0, 2, 0, 'INT']],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result.length).toBe(1)
    expect(result[0].paramName).toBe('value')
    expect(result[0].paramType).toBe('number')
  })

  it('detects FLOAT output as "value" param', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'FloatSource',
          inputs: [],
          widgets_values: [3.14],
        },
      ],
      links: [[1, 10, 0, 2, 0, 'FLOAT']],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result.length).toBe(1)
    expect(result[0].paramName).toBe('value')
    expect(result[0].paramType).toBe('number')
  })

  it('detects BOOLEAN output as "value" param', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'BoolSource',
          inputs: [],
          widgets_values: [true],
        },
      ],
      links: [[1, 10, 0, 2, 0, 'BOOLEAN']],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result.length).toBe(1)
    expect(result[0].paramName).toBe('value')
    expect(result[0].paramType).toBe('boolean')
  })

  it('uses objectInfoMap for widget param resolution when available', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'WAS_Text_Multiline',
          inputs: [],
          widgets_values: ['Hello world'],
        },
      ],
      links: [[1, 10, 0, 2, 0, 'STRING']],
    }
    const objectInfoMap: ObjectInfoMap = {
      WAS_Text_Multiline: {
        input: {
          required: {
            text: ['STRING', { multiline: true }],
          },
        },
        input_order: {
          required: ['text'],
        },
      },
    }
    const result = analyzeGraphSourceNodes(graph as any, objectInfoMap)
    expect(result.length).toBe(1)
    expect(result[0].paramName).toBe('text')
  })

  it('handles objectInfoMap with control_after_generate placeholder', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'SeedNode',
          inputs: [],
          widgets_values: [12345, 'randomize'],
        },
      ],
      links: [[1, 10, 0, 2, 0, 'INT']],
    }
    const objectInfoMap: ObjectInfoMap = {
      SeedNode: {
        input: {
          required: {
            seed: ['INT', { control_after_generate: true }],
          },
        },
        input_order: {
          required: ['seed'],
        },
      },
    }
    const result = analyzeGraphSourceNodes(graph as any, objectInfoMap)
    expect(result.length).toBe(1)
    expect(result[0].paramName).toBe('seed')
    expect(result[0].defaultValue).toBe(12345)
  })

  it('handles multiple primitive outputs from one node', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'MultiOutput',
          inputs: [],
          widgets_values: ['hello'],
        },
      ],
      links: [
        [1, 10, 0, 2, 0, 'STRING'],
        [2, 10, 1, 3, 0, 'INT'],
      ],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    // Without objectInfoMap, produces one entry per primitive output type
    expect(result.length).toBe(2)
  })

  it('handles node with empty widgets_values array', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'EmptyWidgets',
          inputs: [],
          widgets_values: [],
        },
      ],
      links: [[1, 10, 0, 2, 0, 'STRING']],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result).toEqual([])
  })

  it('handles graph with no links', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'Orphan',
          inputs: [],
          widgets_values: ['text'],
        },
      ],
    }
    const result = analyzeGraphSourceNodes(graph as any)
    expect(result).toEqual([])
  })

  it('handles objectInfoMap returning null for unknown node type', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'UnknownNode',
          inputs: [],
          widgets_values: ['text'],
        },
      ],
      links: [[1, 10, 0, 2, 0, 'STRING']],
    }
    const objectInfoMap: ObjectInfoMap = {
      SomeOtherNode: {
        input: { required: { text: ['STRING'] } },
      },
    }
    const result = analyzeGraphSourceNodes(graph as any, objectInfoMap)
    // Falls back to generic paramName
    expect(result.length).toBe(1)
    expect(result[0].paramName).toBe('text')
  })

  it('objectInfoMap with COMBO input type is treated as widget', () => {
    const graph = {
      nodes: [
        {
          id: 10,
          type: 'ComboSource',
          inputs: [],
          widgets_values: ['option_a'],
        },
      ],
      links: [[1, 10, 0, 2, 0, 'STRING']],
    }
    const objectInfoMap: ObjectInfoMap = {
      ComboSource: {
        input: {
          required: {
            mode: [['option_a', 'option_b', 'option_c']],
          },
        },
        input_order: {
          required: ['mode'],
        },
      },
    }
    const result = analyzeGraphSourceNodes(graph as any, objectInfoMap)
    expect(result.length).toBe(1)
    expect(result[0].paramName).toBe('mode')
    expect(result[0].defaultValue).toBe('option_a')
  })
})

// ── buildWidgetParamsFromInfo (tested indirectly via normalizeWorkflow) ──────

describe('buildWidgetParamsFromInfo (via normalizeWorkflow)', () => {
  it('falls back to input_order when not provided, using Object.keys', () => {
    const objectInfoMap: ObjectInfoMap = {
      SimpleNode: {
        input: {
          required: {
            text: ['STRING'],
            seed: ['INT'],
          },
        },
        // No input_order — should fall back to Object.keys
      },
    }
    const graph = {
      nodes: [
        { id: 1, type: 'SimpleNode', inputs: [], widgets_values: ['hello', 42] },
      ],
      links: [],
    }
    const result = normalizeWorkflow(graph as any, objectInfoMap)
    expect(result['1'].inputs.text).toBe('hello')
    expect(result['1'].inputs.seed).toBe(42)
  })

  it('skips non-widget inputs (connectable types like MODEL)', () => {
    const objectInfoMap: ObjectInfoMap = {
      NodeWithModel: {
        input: {
          required: {
            model: ['MODEL'],
            text: ['STRING'],
          },
        },
        input_order: {
          required: ['model', 'text'],
        },
      },
    }
    const graph = {
      nodes: [
        {
          id: 1,
          type: 'NodeWithModel',
          inputs: [{ name: 'model', type: 'MODEL', link: 5 }],
          widgets_values: ['hello'],
        },
      ],
      links: [[5, 2, 0, 1, 0, 'MODEL']],
    }
    const result = normalizeWorkflow(graph as any, objectInfoMap)
    expect(result['1'].inputs.text).toBe('hello')
    expect(result['1'].inputs.model).toEqual(['2', 0])
  })

  it('handles node with no input definition', () => {
    const objectInfoMap: ObjectInfoMap = {
      EmptyNode: {},
    }
    const graph = {
      nodes: [
        { id: 1, type: 'EmptyNode', inputs: [], widgets_values: ['ignored'] },
      ],
      links: [],
    }
    const result = normalizeWorkflow(graph as any, objectInfoMap)
    expect(result['1'].inputs).toEqual({})
  })

  it('returns empty params for node with only non-widget inputs', () => {
    const objectInfoMap: ObjectInfoMap = {
      AllLinked: {
        input: {
          required: {
            model: ['MODEL'],
            clip: ['CLIP'],
          },
        },
      },
    }
    const graph = {
      nodes: [
        { id: 1, type: 'AllLinked', inputs: [], widgets_values: [] },
      ],
      links: [],
    }
    const result = normalizeWorkflow(graph as any, objectInfoMap)
    expect(result['1'].inputs).toEqual({})
  })

  it('handles optional inputs alongside required inputs', () => {
    const objectInfoMap: ObjectInfoMap = {
      MixedNode: {
        input: {
          required: {
            prompt: ['STRING'],
          },
          optional: {
            strength: ['FLOAT'],
          },
        },
        input_order: {
          required: ['prompt'],
          optional: ['strength'],
        },
      },
    }
    const graph = {
      nodes: [
        { id: 1, type: 'MixedNode', inputs: [], widgets_values: ['test', 0.75] },
      ],
      links: [],
    }
    const result = normalizeWorkflow(graph as any, objectInfoMap)
    expect(result['1'].inputs.prompt).toBe('test')
    expect(result['1'].inputs.strength).toBe(0.75)
  })

  it('does not overwrite linked inputs with widget values', () => {
    const objectInfoMap: ObjectInfoMap = {
      TestNode: {
        input: {
          required: {
            text: ['STRING'],
          },
        },
        input_order: {
          required: ['text'],
        },
      },
    }
    const graph = {
      nodes: [
        {
          id: 1,
          type: 'TestNode',
          inputs: [{ name: 'text', type: 'STRING', link: 10 }],
          widgets_values: ['fallback_value'],
        },
        { id: 2, type: 'Source', inputs: [], widgets_values: ['source'] },
      ],
      links: [[10, 2, 0, 1, 0, 'STRING']],
    }
    const result = normalizeWorkflow(graph as any, objectInfoMap)
    // text should be linked, not overwritten by widget value
    expect(result['1'].inputs.text).toEqual(['2', 0])
  })

  it('BOOLEAN type is recognized as widget', () => {
    const objectInfoMap: ObjectInfoMap = {
      BoolNode: {
        input: {
          required: {
            enabled: ['BOOLEAN'],
          },
        },
      },
    }
    const graph = {
      nodes: [
        { id: 1, type: 'BoolNode', inputs: [], widgets_values: [true] },
      ],
      links: [],
    }
    const result = normalizeWorkflow(graph as any, objectInfoMap)
    expect(result['1'].inputs.enabled).toBe(true)
  })
})
