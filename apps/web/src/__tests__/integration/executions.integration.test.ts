import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, makeRequest } from './setup'
import type { TestDb } from './setup'

let db: TestDb

vi.mock('../../lib/db', () => ({
  getDb: () => db,
}))

// Skip the port-probe noise from autoRouteComfyPort. Without this, getRunningPorts
// fires fetch(/system_stats) calls against well-known + configured ports — on a
// developer machine where some of those ports are bound, those probes consume
// the test's mockResolvedValueOnce mocks for /object_info + /prompt (since
// once-mocks are consumed in call order, not by URL). The route always falls
// back to the tool's stored comfyPort when this returns null.
vi.mock('../../lib/comfyAutoRoute', async () => {
  const actual = await vi.importActual<typeof import('../../lib/comfyAutoRoute')>('../../lib/comfyAutoRoute')
  return {
    ...actual,
    autoRouteComfyPort: vi.fn(async (fallback?: number | null) => fallback ?? null),
  }
})

// Mock fetch for ComfyUI calls (used by POST executions and PATCH save-to-disk).
// URL-routed defaults handle "noise" probes (e.g. autoRouteComfyPort scanning
// well-known ports) so test mocks for /object_info and /prompt aren't consumed
// by them. Tests can still override via mockResolvedValueOnce / mockImplementationOnce.
const mockFetch = vi.fn()
globalThis.fetch = mockFetch

function defaultRoutedFetch(url: string | URL | Request): Promise<Response> {
  const u = typeof url === 'string' ? url : url instanceof URL ? url.toString() : url.url
  // /system_stats probes from autoRouteComfyPort.getRunningPorts — return
  // not-ok so probePort treats the port as unavailable and skips it. This
  // makes tests deterministic regardless of which dev ports happen to be
  // open on the host machine.
  if (u.includes('/system_stats')) {
    return Promise.resolve(new Response(null, { status: 503 }))
  }
  // Anything else: fail loudly so unmocked calls don't silently pass.
  return Promise.resolve(new Response(JSON.stringify({ error: 'unmocked fetch' }), { status: 500 }))
}

// Mock fs/promises for saveOutputsToDisk
vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  writeFile: vi.fn().mockResolvedValue(undefined),
}))

import { GET as getToolExecs, POST as createExecution } from '../../app/api/tools/[id]/executions/route'
import { PATCH as patchExecution } from '../../app/api/executions/[id]/route'
import { POST as createTool } from '../../app/api/tools/route'

describe('Executions integration', () => {
  const toolPayload = {
    name: 'Exec Tool',
    description: 'A tool for execution tests',
    workflowJson: JSON.stringify({
      '1': { class_type: 'CLIPTextEncode', inputs: { text: 'hello', clip: ['2', 0] } },
      '2': { class_type: 'SaveImage', inputs: { images: ['1', 0], filename_prefix: 'out' } },
    }),
    workflowHash: 'exec-hash-123',
    schemaJson: JSON.stringify([
      { nodeId: '1', paramName: 'text', isInput: true, nodeType: 'CLIPTextEncode', defaultValue: 'hello' },
      { nodeId: '2', paramName: 'images', isInput: false, nodeType: 'SaveImage' },
    ]),
    layout: 'left-right',
    comfyPort: 8188,
  }

  let toolId: string

  beforeEach(async () => {
    db = createTestDb()
    mockFetch.mockReset()
    // Default to URL-routed responses so port-probe noise doesn't consume
    // the test's `/object_info` and `/prompt` mocks. Tests can still queue
    // mockResolvedValueOnce — those take priority over the default impl.
    mockFetch.mockImplementation(defaultRoutedFetch as never)

    // Create a tool to attach executions to
    const req = makeRequest('/api/tools', {
      method: 'POST',
      body: JSON.stringify(toolPayload),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createTool(req)
    const tool = await res.json()
    toolId = tool.id
  })

  // ── GET /api/tools/[id]/executions ───────────────────────────────────

  it('GET returns empty array when no executions exist', async () => {
    const req = makeRequest(`/api/tools/${toolId}/executions`)
    const res = await getToolExecs(req, { params: Promise.resolve({ id: toolId }) })
    expect(res.status).toBe(200)
    const execs = await res.json()
    expect(execs).toEqual([])
  })

  // ── POST /api/tools/[id]/executions ──────────────────────────────────

  it('POST queues a prompt and returns 202 with execution data', async () => {
    // Mock /object_info
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
    // Mock /prompt (ComfyUI queue)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ prompt_id: 'prompt-abc' }),
    })

    const req = makeRequest(`/api/tools/${toolId}/executions`, {
      method: 'POST',
      body: JSON.stringify({ inputs: { '1__text': 'a dog' } }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createExecution(req, { params: Promise.resolve({ id: toolId }) })
    expect(res.status).toBe(202)

    const data = await res.json()
    expect(data.executionId).toBeDefined()
    expect(data.promptId).toBe('prompt-abc')
    expect(data.comfyPort).toBe(8188)
    expect(data.seed).toBeDefined()
    // type field must be present so useBatchQueue fires onComfyJobStarted
    expect(data.type).toBe('comfyui')
  })

  it('POST returns 404 for non-existent tool', async () => {
    const req = makeRequest('/api/tools/missing/executions', {
      method: 'POST',
      body: JSON.stringify({ inputs: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createExecution(req, { params: Promise.resolve({ id: 'missing' }) })
    expect(res.status).toBe(404)
  })

  it('POST returns 502 when ComfyUI rejects the prompt', async () => {
    // Mock /object_info
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
    // Mock /prompt failure
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: () => Promise.resolve({
        error: { message: 'Node validation failed' },
        node_errors: {
          '1': { class_type: 'CLIPTextEncode', errors: [{ details: 'Missing clip input' }] },
        },
      }),
    })

    const req = makeRequest(`/api/tools/${toolId}/executions`, {
      method: 'POST',
      body: JSON.stringify({ inputs: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createExecution(req, { params: Promise.resolve({ id: toolId }) })
    expect(res.status).toBe(502)

    const data = await res.json()
    expect(data.error).toContain('CLIPTextEncode')
    expect(data.nodeErrors).toBeDefined()
  })

  it('POST continues gracefully when /object_info fails', async () => {
    // Mock /object_info failure
    mockFetch.mockRejectedValueOnce(new Error('connection refused'))
    // Mock /prompt success
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ prompt_id: 'prompt-xyz' }),
    })

    const req = makeRequest(`/api/tools/${toolId}/executions`, {
      method: 'POST',
      body: JSON.stringify({ inputs: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createExecution(req, { params: Promise.resolve({ id: toolId }) })
    expect(res.status).toBe(202)
  })

  it('POST generates a random seed when not provided', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ prompt_id: 'prompt-seed' }),
    })

    const req = makeRequest(`/api/tools/${toolId}/executions`, {
      method: 'POST',
      body: JSON.stringify({ inputs: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createExecution(req, { params: Promise.resolve({ id: toolId }) })
    const data = await res.json()
    expect(typeof data.seed).toBe('number')
    expect(data.seed).toBeGreaterThanOrEqual(0)
  })

  it('GET returns executions after creation, ordered by createdAt desc', async () => {
    // Create two executions
    for (let i = 0; i < 2; i++) {
      mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () => Promise.resolve({ prompt_id: `prompt-${i}` }),
      })
      const req = makeRequest(`/api/tools/${toolId}/executions`, {
        method: 'POST',
        body: JSON.stringify({ inputs: {} }),
        headers: { 'Content-Type': 'application/json' },
      })
      await createExecution(req, { params: Promise.resolve({ id: toolId }) })
    }

    const req = makeRequest(`/api/tools/${toolId}/executions`)
    const res = await getToolExecs(req, { params: Promise.resolve({ id: toolId }) })
    const execs = await res.json()
    expect(execs.length).toBe(2)
    expect(execs[0].createdAt).toBeGreaterThanOrEqual(execs[1].createdAt)
  })

  // ── PATCH /api/executions/[id] ───────────────────────────────────────

  it('PATCH updates execution status and outputs', async () => {
    // Create an execution first
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ prompt_id: 'prompt-patch' }),
    })

    const createReq = makeRequest(`/api/tools/${toolId}/executions`, {
      method: 'POST',
      body: JSON.stringify({ inputs: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    const createRes = await createExecution(createReq, { params: Promise.resolve({ id: toolId }) })
    const { executionId } = await createRes.json()

    // Mock the fetch for saveOutputsToDisk (image download)
    mockFetch.mockResolvedValueOnce({
      ok: true,
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(8)),
    })

    const patchReq = makeRequest(`/api/executions/${executionId}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status: 'completed',
        outputsJson: JSON.stringify([{ filename: 'output.png' }]),
        completedAt: Date.now(),
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchExecution(patchReq, { params: Promise.resolve({ id: executionId }) })
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.status).toBe('completed')
    // saveOutputsToDisk must rewrite paths to /api/outputs/... so the client
    // can render them — raw ComfyUI filenames are not valid image URLs
    const outputs = JSON.parse(data.outputsJson)
    expect(outputs[0].path).toMatch(/^\/api\/outputs\//)
    expect(outputs[0].path).toContain('output.png')
  })

  it('PATCH updates execution with error status', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ prompt_id: 'prompt-err' }),
    })

    const createReq = makeRequest(`/api/tools/${toolId}/executions`, {
      method: 'POST',
      body: JSON.stringify({ inputs: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    const createRes = await createExecution(createReq, { params: Promise.resolve({ id: toolId }) })
    const { executionId } = await createRes.json()

    const patchReq = makeRequest(`/api/executions/${executionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'error', errorMessage: 'OOM', completedAt: Date.now() }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchExecution(patchReq, { params: Promise.resolve({ id: executionId }) })
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('error')
    expect(data.errorMessage).toBe('OOM')
  })

  it('PATCH returns 400 for empty updates', async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: () => Promise.resolve({}) })
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve({ prompt_id: 'prompt-empty' }),
    })

    const createReq = makeRequest(`/api/tools/${toolId}/executions`, {
      method: 'POST',
      body: JSON.stringify({ inputs: {} }),
      headers: { 'Content-Type': 'application/json' },
    })
    const createRes = await createExecution(createReq, { params: Promise.resolve({ id: toolId }) })
    const { executionId } = await createRes.json()

    const patchReq = makeRequest(`/api/executions/${executionId}`, {
      method: 'PATCH',
      body: JSON.stringify({ unknownField: 'ignored' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchExecution(patchReq, { params: Promise.resolve({ id: executionId }) })
    expect(res.status).toBe(400)
  })
})
