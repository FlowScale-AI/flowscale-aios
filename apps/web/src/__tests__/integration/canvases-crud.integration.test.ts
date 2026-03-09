import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, seedAdmin, createTestSession, makeRequest } from './setup'
import type { TestDb } from './setup'

let db: TestDb

vi.mock('../../lib/db', () => ({
  getDb: () => db,
}))

import { GET as getCanvases, POST as createCanvas } from '../../app/api/canvases/route'
import { GET as getCanvas, PATCH as patchCanvas, DELETE as deleteCanvas } from '../../app/api/canvases/[id]/route'
import { GET as getItems, POST as upsertItems, PATCH as replaceItems } from '../../app/api/canvases/[id]/items/route'

describe('Canvases CRUD integration', () => {
  let adminToken: string

  beforeEach(() => {
    db = createTestDb()
    const admin = seedAdmin(db)
    adminToken = createTestSession(db, admin.id)
  })

  function authedReq(url: string, init?: any) {
    return makeRequest(url, {
      ...init,
      cookies: { fs_session: adminToken },
    })
  }

  async function createOne(name = 'Test Canvas') {
    const req = makeRequest('/api/canvases', {
      method: 'POST',
      body: JSON.stringify({ name, description: 'A test canvas' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createCanvas(req)
    return res.json()
  }

  it('POST /api/canvases creates a canvas with defaults', async () => {
    const req = makeRequest('/api/canvases', {
      method: 'POST',
      body: JSON.stringify({ name: 'My Canvas' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await createCanvas(req)
    expect(res.status).toBe(201)

    const canvas = await res.json()
    expect(canvas._id).toBeDefined()
    expect(canvas.name).toBe('My Canvas')
    expect(canvas.viewport).toEqual({ x: 0, y: 0, zoom: 1 })
    expect(canvas.settings.grid_size).toBe(8)
    expect(canvas.is_shared).toBe(false)
    expect(canvas.team_id).toBe('local')
  })

  it('POST /api/canvases with custom viewport and settings', async () => {
    const req = makeRequest('/api/canvases', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Custom',
        viewport: { x: 100, y: 200, zoom: 2 },
        settings: { grid_size: 16, snap_to_grid: true, background: '#000000' },
      }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await createCanvas(req)
    const canvas = await res.json()
    expect(canvas.viewport).toEqual({ x: 100, y: 200, zoom: 2 })
    expect(canvas.settings.grid_size).toBe(16)
    expect(canvas.settings.background).toBe('#000000')
  })

  it('GET /api/canvases lists all canvases', async () => {
    await createOne('Canvas A')
    await createOne('Canvas B')

    const res = await getCanvases()
    expect(res.status).toBe(200)
    const canvases = await res.json()
    expect(canvases.length).toBe(2)
  })

  it('GET /api/canvases/[id] returns a specific canvas', async () => {
    const created = await createOne()

    const res = await getCanvas(
      makeRequest(`/api/canvases/${created._id}`),
      { params: Promise.resolve({ id: created._id }) },
    )
    expect(res.status).toBe(200)
    const canvas = await res.json()
    expect(canvas._id).toBe(created._id)
  })

  it('GET /api/canvases/[id] returns 404 for missing canvas', async () => {
    const res = await getCanvas(
      makeRequest('/api/canvases/missing'),
      { params: Promise.resolve({ id: 'missing' }) },
    )
    expect(res.status).toBe(404)
  })

  it('PATCH /api/canvases/[id] toggles is_shared', async () => {
    const created = await createOne()

    const req = authedReq(`/api/canvases/${created._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_shared: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchCanvas(req, { params: Promise.resolve({ id: created._id }) })
    expect(res.status).toBe(200)
    const canvas = await res.json()
    expect(canvas.is_shared).toBe(true)
    expect(canvas.updated_at).not.toBe(created.updated_at)
  })

  it('PATCH /api/canvases/[id] returns 401 without auth', async () => {
    const created = await createOne()

    const req = makeRequest(`/api/canvases/${created._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ is_shared: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchCanvas(req, { params: Promise.resolve({ id: created._id }) })
    expect(res.status).toBe(401)
  })

  it('PATCH /api/canvases/[id] returns 400 for no valid fields', async () => {
    const created = await createOne()

    const req = authedReq(`/api/canvases/${created._id}`, {
      method: 'PATCH',
      body: JSON.stringify({ name: 'ignored' }), // name is not patchable via this route
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchCanvas(req, { params: Promise.resolve({ id: created._id }) })
    expect(res.status).toBe(400)
  })

  it('DELETE /api/canvases/[id] removes a canvas', async () => {
    const created = await createOne()

    const res = await deleteCanvas(
      makeRequest(`/api/canvases/${created._id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id: created._id }) },
    )
    expect(res.status).toBe(204)

    // Verify gone
    const getRes = await getCanvas(
      makeRequest(`/api/canvases/${created._id}`),
      { params: Promise.resolve({ id: created._id }) },
    )
    expect(getRes.status).toBe(404)
  })

  // ── Canvas Items ─────────────────────────────────────────────────────

  const sampleItem = {
    _id: 'item-1',
    type: 'image',
    position: { x: 10, y: 20, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
    z_index: 1,
    locked: false,
    hidden: false,
    data: { label: 'Test Image' },
    properties: { border_width: 1 },
  }

  it('POST /api/canvases/[id]/items upserts items', async () => {
    const canvas = await createOne()
    const id = canvas._id

    const req = makeRequest(`/api/canvases/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [sampleItem] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await upsertItems(req, { params: Promise.resolve({ id }) })
    expect(res.status).toBe(204)

    // Verify item exists
    const getRes = await getItems(
      makeRequest(`/api/canvases/${id}/items`),
      { params: Promise.resolve({ id }) },
    )
    const items = await getRes.json()
    expect(items.length).toBe(1)
    expect(items[0]._id).toBe('item-1')
    expect(items[0].type).toBe('image')
    expect(items[0].data.label).toBe('Test Image')
    expect(items[0].position.x).toBe(10)
  })

  it('POST /api/canvases/[id]/items upserts (updates existing)', async () => {
    const canvas = await createOne()
    const id = canvas._id

    // Insert first
    const req1 = makeRequest(`/api/canvases/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [sampleItem] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await upsertItems(req1, { params: Promise.resolve({ id }) })

    // Update same item
    const updatedItem = { ...sampleItem, z_index: 5, data: { label: 'Updated' } }
    const req2 = makeRequest(`/api/canvases/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [updatedItem] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await upsertItems(req2, { params: Promise.resolve({ id }) })

    const getRes = await getItems(
      makeRequest(`/api/canvases/${id}/items`),
      { params: Promise.resolve({ id }) },
    )
    const items = await getRes.json()
    expect(items.length).toBe(1) // still one item
    expect(items[0].z_index).toBe(5)
    expect(items[0].data.label).toBe('Updated')
  })

  it('PATCH /api/canvases/[id]/items replaces all items', async () => {
    const canvas = await createOne()
    const id = canvas._id

    // Insert 2 items
    const req1 = makeRequest(`/api/canvases/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [
        sampleItem,
        { ...sampleItem, _id: 'item-2' },
      ]}),
      headers: { 'Content-Type': 'application/json' },
    })
    await upsertItems(req1, { params: Promise.resolve({ id }) })

    // Replace with 1 item
    const req2 = makeRequest(`/api/canvases/${id}/items`, {
      method: 'PATCH',
      body: JSON.stringify({ items: [{ ...sampleItem, _id: 'item-3' }] }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await replaceItems(req2, { params: Promise.resolve({ id }) })
    expect(res.status).toBe(204)

    const getRes = await getItems(
      makeRequest(`/api/canvases/${id}/items`),
      { params: Promise.resolve({ id }) },
    )
    const items = await getRes.json()
    expect(items.length).toBe(1)
    expect(items[0]._id).toBe('item-3')
  })

  it('PATCH /api/canvases/[id]/items with empty array clears all items', async () => {
    const canvas = await createOne()
    const id = canvas._id

    // Insert item
    const req1 = makeRequest(`/api/canvases/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [sampleItem] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await upsertItems(req1, { params: Promise.resolve({ id }) })

    // Replace with empty
    const req2 = makeRequest(`/api/canvases/${id}/items`, {
      method: 'PATCH',
      body: JSON.stringify({ items: [] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await replaceItems(req2, { params: Promise.resolve({ id }) })

    const getRes = await getItems(
      makeRequest(`/api/canvases/${id}/items`),
      { params: Promise.resolve({ id }) },
    )
    const items = await getRes.json()
    expect(items.length).toBe(0)
  })

  it('DELETE canvas cascades to items', async () => {
    const canvas = await createOne()
    const id = canvas._id

    // Add item
    const req = makeRequest(`/api/canvases/${id}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [sampleItem] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await upsertItems(req, { params: Promise.resolve({ id }) })

    // Delete canvas
    await deleteCanvas(
      makeRequest(`/api/canvases/${id}`, { method: 'DELETE' }),
      { params: Promise.resolve({ id }) },
    )

    // Items should be gone too (cascade)
    const getRes = await getItems(
      makeRequest(`/api/canvases/${id}/items`),
      { params: Promise.resolve({ id }) },
    )
    const items = await getRes.json()
    expect(items.length).toBe(0)
  })
})
