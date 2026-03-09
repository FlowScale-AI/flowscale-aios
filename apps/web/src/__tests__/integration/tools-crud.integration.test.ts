import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, seedAdmin, createTestSession, makeRequest } from './setup'
import type { TestDb } from './setup'

let db: TestDb
let adminToken: string

// Mock getDb to return our test DB
vi.mock('../../lib/db', () => ({
  getDb: () => db,
}))

// Mock fetch used by deploy route (not needed for CRUD)
globalThis.fetch = vi.fn()

import { GET as getTools, POST as createTool } from '../../app/api/tools/route'
import { GET as getTool, PATCH as patchTool, DELETE as deleteTool } from '../../app/api/tools/[id]/route'
import { POST as deployTool } from '../../app/api/tools/[id]/deploy/route'

describe('Tools CRUD integration', () => {
  beforeEach(() => {
    db = createTestDb()
    const admin = seedAdmin(db)
    adminToken = createTestSession(db, admin.id)
  })

  const toolPayload = {
    name: 'Test Tool',
    description: 'A test tool',
    workflowJson: JSON.stringify({ '1': { class_type: 'SaveImage', inputs: {} } }),
    workflowHash: 'abc123hash',
    schemaJson: JSON.stringify([{ nodeId: '1', paramName: 'output', isInput: false }]),
    layout: 'left-right',
    comfyPort: 8188,
  }

  async function createOneTool() {
    const req = makeRequest('/api/tools', {
      method: 'POST',
      body: JSON.stringify(toolPayload),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createTool(req)
    return res.json()
  }

  it('POST /api/tools creates a tool and returns 201', async () => {
    const req = makeRequest('/api/tools', {
      method: 'POST',
      body: JSON.stringify(toolPayload),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await createTool(req)
    expect(res.status).toBe(201)

    const tool = await res.json()
    expect(tool.id).toBeDefined()
    expect(tool.name).toBe('Test Tool')
    expect(tool.status).toBe('dev')
    expect(tool.version).toBe(1)
    expect(tool.comfyPort).toBe(8188)
  })

  it('POST /api/tools returns 400 when required fields are missing', async () => {
    const req = makeRequest('/api/tools', {
      method: 'POST',
      body: JSON.stringify({ name: 'Incomplete' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await createTool(req)
    expect(res.status).toBe(400)
  })

  it('GET /api/tools returns all tools', async () => {
    await createOneTool()
    await createOneTool()

    const req = makeRequest('/api/tools')
    const res = await getTools(req)
    expect(res.status).toBe(200)

    const tools = await res.json()
    expect(tools.length).toBe(2)
  })

  it('GET /api/tools?status=dev filters by status', async () => {
    await createOneTool()

    const req = makeRequest('/api/tools?status=production')
    const res = await getTools(req)
    const tools = await res.json()
    expect(tools.length).toBe(0) // tool is 'dev', not 'production'
  })

  it('GET /api/tools/[id] returns a specific tool', async () => {
    const created = await createOneTool()

    const req = makeRequest(`/api/tools/${created.id}`)
    const res = await getTool(req, { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(200)

    const tool = await res.json()
    expect(tool.id).toBe(created.id)
    expect(tool.name).toBe('Test Tool')
  })

  it('GET /api/tools/[id] returns 404 for non-existent id', async () => {
    const req = makeRequest('/api/tools/non-existent')
    const res = await getTool(req, { params: Promise.resolve({ id: 'non-existent' }) })
    expect(res.status).toBe(404)
  })

  it('PATCH /api/tools/[id] updates allowed fields', async () => {
    const created = await createOneTool()

    const req = makeRequest(`/api/tools/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'Updated Name', description: 'New desc' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchTool(req, { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(200)

    const tool = await res.json()
    expect(tool.name).toBe('Updated Name')
    expect(tool.description).toBe('New desc')
  })

  it('PATCH /api/tools/[id] returns 400 for empty updates', async () => {
    const created = await createOneTool()

    const req = makeRequest(`/api/tools/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ unknownField: 'ignored' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchTool(req, { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/tools/[id] removes a tool', async () => {
    const created = await createOneTool()

    const req = makeRequest(`/api/tools/${created.id}`, { method: 'DELETE' })
    const res = await deleteTool(req, { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(204)

    // Verify it's gone
    const getReq = makeRequest(`/api/tools/${created.id}`)
    const getRes = await getTool(getReq, { params: Promise.resolve({ id: created.id }) })
    expect(getRes.status).toBe(404)
  })

  it('POST /api/tools/[id]/deploy sets status to production', async () => {
    const created = await createOneTool()

    const req = makeRequest(`/api/tools/${created.id}/deploy`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await deployTool(req, { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(200)

    const tool = await res.json()
    expect(tool.status).toBe('production')
    expect(tool.deployedAt).toBeDefined()
    expect(tool.version).toBe(1) // first deploy doesn't increment
  })

  it('deploy increments version on re-deploy', async () => {
    const created = await createOneTool()

    // First deploy
    const req1 = makeRequest(`/api/tools/${created.id}/deploy`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    await deployTool(req1, { params: Promise.resolve({ id: created.id }) })

    // Second deploy (re-deploy)
    const req2 = makeRequest(`/api/tools/${created.id}/deploy`, {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res2 = await deployTool(req2, { params: Promise.resolve({ id: created.id }) })
    const tool = await res2.json()
    expect(tool.version).toBe(2) // incremented on re-deploy
  })

  it('deploy sets modelVersion when provided', async () => {
    const created = await createOneTool()

    const req = makeRequest(`/api/tools/${created.id}/deploy`, {
      method: 'POST',
      body: JSON.stringify({ modelVersion: 'v2.1' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await deployTool(req, { params: Promise.resolve({ id: created.id }) })
    const tool = await res.json()
    expect(tool.modelVersion).toBe('v2.1')
  })

  it('deploy returns 404 for non-existent tool', async () => {
    const req = makeRequest('/api/tools/fake-id/deploy', {
      method: 'POST',
      body: JSON.stringify({}),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await deployTool(req, { params: Promise.resolve({ id: 'fake-id' }) })
    expect(res.status).toBe(404)
  })

  it('GET /api/tools returns sorted by createdAt desc', async () => {
    await createOneTool()
    // Small delay to ensure different timestamps
    await new Promise(r => setTimeout(r, 10))
    await createOneTool()

    const req = makeRequest('/api/tools')
    const res = await getTools(req)
    const tools = await res.json()
    expect(tools[0].createdAt).toBeGreaterThanOrEqual(tools[1].createdAt)
  })
})
