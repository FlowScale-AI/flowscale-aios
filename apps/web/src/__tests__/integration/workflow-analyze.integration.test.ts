import { describe, it, expect, vi, beforeAll } from 'vitest'

// Mock fetch for the /object_info call
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

// No DB needed for this route — it only uses @flowscale/workflow
import { POST } from '../../app/api/workflow/analyze/route'
import { makeRequest } from './setup'

describe('POST /api/workflow/analyze (integration)', () => {
  beforeAll(() => {
    mockFetch.mockReset()
  })

  const apiWorkflow = {
    '1': { class_type: 'CLIPTextEncode', inputs: { text: 'a cat', clip: ['2', 0] } },
    '2': { class_type: 'CheckpointLoaderSimple', inputs: { ckpt_name: 'v1-5.safetensors' } },
    '3': { class_type: 'KSampler', inputs: {
      seed: 42, steps: 20, cfg: 7, sampler_name: 'euler', scheduler: 'normal', denoise: 1.0,
      model: ['2', 0], positive: ['1', 0], negative: ['4', 0], latent_image: ['5', 0],
    }},
    '4': { class_type: 'CLIPTextEncode', inputs: { text: 'bad', clip: ['2', 1] } },
    '5': { class_type: 'EmptyLatentImage', inputs: { width: 512, height: 512, batch_size: 1 } },
    '6': { class_type: 'SaveImage', inputs: { filename_prefix: 'output', images: ['7', 0] } },
    '7': { class_type: 'VAEDecode', inputs: { samples: ['3', 0], vae: ['2', 2] } },
  }

  it('returns schema and hash for a valid API-format workflow', async () => {
    const req = makeRequest('/api/workflow/analyze', {
      method: 'POST',
      body: JSON.stringify({ workflowJson: JSON.stringify(apiWorkflow) }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.hash).toBeDefined()
    expect(data.hash.length).toBe(64) // sha256 hex
    expect(Array.isArray(data.schema)).toBe(true)

    // Should detect SaveImage as output
    const outputs = data.schema.filter((io: any) => !io.isInput)
    expect(outputs.length).toBe(1)
    expect(outputs[0].nodeType).toBe('SaveImage')

    // Should detect inputs for CLIPTextEncode, KSampler, EmptyLatentImage
    const inputs = data.schema.filter((io: any) => io.isInput)
    expect(inputs.length).toBeGreaterThan(0)
    const nodeTypes = [...new Set(inputs.map((io: any) => io.nodeType))]
    expect(nodeTypes).toContain('CLIPTextEncode')
    expect(nodeTypes).toContain('KSampler')
    expect(nodeTypes).toContain('EmptyLatentImage')
  })

  it('returns 400 when workflowJson is missing', async () => {
    const req = makeRequest('/api/workflow/analyze', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('workflowJson')
  })

  it('returns 400 for invalid JSON string', async () => {
    const req = makeRequest('/api/workflow/analyze', {
      method: 'POST',
      body: JSON.stringify({ workflowJson: 'not valid json{{{' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid JSON')
  })

  it('returns 422 for valid JSON that is not a ComfyUI workflow', async () => {
    const req = makeRequest('/api/workflow/analyze', {
      method: 'POST',
      body: JSON.stringify({ workflowJson: JSON.stringify({ foo: 'bar' }) }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(422)
  })

  it('handles graph-format workflows with source node deduplication', async () => {
    const graphWorkflow = {
      nodes: [
        { id: 1, type: 'CLIPTextEncode', inputs: [{ name: 'clip', type: 'CLIP', link: 10 }], widgets_values: ['hello'] },
        { id: 2, type: 'CheckpointLoaderSimple', inputs: [], widgets_values: ['model.safetensors'] },
        { id: 3, type: 'SaveImage', inputs: [{ name: 'images', type: 'IMAGE', link: 5 }], widgets_values: ['output'] },
        // Source node: custom text node with no linked inputs, outputting STRING
        { id: 10, type: 'WAS_Text_Multiline', inputs: [], widgets_values: ['source text'] },
      ],
      links: [
        [5, 7, 0, 3, 0, 'IMAGE'],
        [10, 2, 1, 1, 0, 'CLIP'],
        [20, 10, 0, 1, 0, 'STRING'],
      ],
    }

    const req = makeRequest('/api/workflow/analyze', {
      method: 'POST',
      body: JSON.stringify({ workflowJson: JSON.stringify(graphWorkflow) }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    // Source node should appear in schema
    const sourceIOs = data.schema.filter((io: any) => io.nodeType === 'WAS_Text_Multiline')
    expect(sourceIOs.length).toBeGreaterThan(0)

    // No duplicates — same nodeId+paramName should not appear twice
    const keys = data.schema.map((io: any) => `${io.nodeId}:${io.paramName}`)
    const unique = new Set(keys)
    expect(unique.size).toBe(keys.length)
  })

  it('fetches /object_info when comfyPort is provided', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({
        CLIPTextEncode: {
          input: { required: { text: ['STRING', { multiline: true }], clip: ['CLIP'] } },
          input_order: { required: ['text', 'clip'] },
        },
      }),
    })

    const simpleWorkflow = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'hello', clip: ['2', 0] } },
      '2': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'out' } },
    }

    const req = makeRequest('/api/workflow/analyze', {
      method: 'POST',
      body: JSON.stringify({
        workflowJson: JSON.stringify(simpleWorkflow),
        comfyPort: 8188,
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200)
    expect(mockFetch).toHaveBeenCalledWith(
      'http://localhost:8188/object_info',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('continues gracefully when /object_info fetch fails', async () => {
    mockFetch.mockRejectedValueOnce(new Error('connection refused'))

    const simpleWorkflow = {
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'hello', clip: ['2', 0] } },
      '2': { class_type: 'SaveImage', inputs: { images: ['3', 0], filename_prefix: 'out' } },
    }

    const req = makeRequest('/api/workflow/analyze', {
      method: 'POST',
      body: JSON.stringify({
        workflowJson: JSON.stringify(simpleWorkflow),
        comfyPort: 8188,
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await POST(req)
    expect(res.status).toBe(200) // still works without object_info
  })

  it('produces consistent hashes for the same input', async () => {
    const workflowStr = JSON.stringify(apiWorkflow)

    const req1 = makeRequest('/api/workflow/analyze', {
      method: 'POST',
      body: JSON.stringify({ workflowJson: workflowStr }),
      headers: { 'Content-Type': 'application/json' },
    })
    const req2 = makeRequest('/api/workflow/analyze', {
      method: 'POST',
      body: JSON.stringify({ workflowJson: workflowStr }),
      headers: { 'Content-Type': 'application/json' },
    })

    const [res1, res2] = await Promise.all([POST(req1), POST(req2)])
    const [data1, data2] = await Promise.all([res1.json(), res2.json()])
    expect(data1.hash).toBe(data2.hash)
  })
})
