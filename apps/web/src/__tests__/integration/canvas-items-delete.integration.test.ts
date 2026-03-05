import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, makeRequest } from './setup'
import type { TestDb } from './setup'

let db: TestDb

vi.mock('../../lib/db', () => ({
  getDb: () => db,
}))

import { POST as createCanvas } from '../../app/api/canvases/route'
import { GET as getItems, POST as upsertItems } from '../../app/api/canvases/[id]/items/route'
import { DELETE as deleteItem } from '../../app/api/canvases/[id]/items/[itemId]/route'
import { PATCH as patchCanvas } from '../../app/api/canvases/[id]/route'

describe('Canvas item deletion and extra canvas tests', () => {
  let canvasId: string

  const sampleItem = {
    _id: 'item-del-1',
    type: 'image',
    position: { x: 10, y: 20, width: 100, height: 100, rotation: 0, scale_x: 1, scale_y: 1 },
    z_index: 1,
    locked: false,
    hidden: false,
    data: { label: 'Test' },
    properties: {},
  }

  beforeEach(async () => {
    db = createTestDb()

    const req = makeRequest('/api/canvases', {
      method: 'POST',
      body: JSON.stringify({ name: 'Delete Test Canvas' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createCanvas(req)
    const canvas = await res.json()
    canvasId = canvas._id
  })

  it('DELETE /api/canvases/[id]/items/[itemId] removes a single item', async () => {
    // Insert two items
    const item2 = { ...sampleItem, _id: 'item-del-2' }
    const upsertReq = makeRequest(`/api/canvases/${canvasId}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [sampleItem, item2] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await upsertItems(upsertReq, { params: Promise.resolve({ id: canvasId }) })

    // Delete one item
    const delReq = makeRequest(`/api/canvases/${canvasId}/items/item-del-1`, { method: 'DELETE' })
    const delRes = await deleteItem(delReq, {
      params: Promise.resolve({ id: canvasId, itemId: 'item-del-1' }),
    })
    expect(delRes.status).toBe(204)

    // Verify only one item remains
    const getReq = makeRequest(`/api/canvases/${canvasId}/items`)
    const getRes = await getItems(getReq, { params: Promise.resolve({ id: canvasId }) })
    const items = await getRes.json()
    expect(items.length).toBe(1)
    expect(items[0]._id).toBe('item-del-2')
  })

  it('DELETE non-existent item returns 204 (idempotent)', async () => {
    const req = makeRequest(`/api/canvases/${canvasId}/items/no-such-item`, { method: 'DELETE' })
    const res = await deleteItem(req, {
      params: Promise.resolve({ id: canvasId, itemId: 'no-such-item' }),
    })
    expect(res.status).toBe(204)
  })

  it('PATCH /api/canvases/[id] returns 404 for non-existent canvas', async () => {
    const req = makeRequest('/api/canvases/missing-canvas', {
      method: 'PATCH',
      body: JSON.stringify({ is_shared: true }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchCanvas(req, { params: Promise.resolve({ id: 'missing-canvas' }) })
    expect(res.status).toBe(404)
  })

  it('items preserve locked and hidden boolean fields', async () => {
    const lockedItem = { ...sampleItem, _id: 'locked-item', locked: true, hidden: true }
    const upsertReq = makeRequest(`/api/canvases/${canvasId}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [lockedItem] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await upsertItems(upsertReq, { params: Promise.resolve({ id: canvasId }) })

    const getReq = makeRequest(`/api/canvases/${canvasId}/items`)
    const getRes = await getItems(getReq, { params: Promise.resolve({ id: canvasId }) })
    const items = await getRes.json()
    expect(items[0].locked).toBe(true)
    expect(items[0].hidden).toBe(true)
  })

  it('items with no data or properties return undefined', async () => {
    const minimalItem = {
      _id: 'minimal-item',
      type: 'note',
      position: { x: 0, y: 0, width: 50, height: 50, rotation: 0, scale_x: 1, scale_y: 1 },
      z_index: 0,
      locked: false,
      hidden: false,
    }
    const upsertReq = makeRequest(`/api/canvases/${canvasId}/items`, {
      method: 'POST',
      body: JSON.stringify({ items: [minimalItem] }),
      headers: { 'Content-Type': 'application/json' },
    })
    await upsertItems(upsertReq, { params: Promise.resolve({ id: canvasId }) })

    const getReq = makeRequest(`/api/canvases/${canvasId}/items`)
    const getRes = await getItems(getReq, { params: Promise.resolve({ id: canvasId }) })
    const items = await getRes.json()
    expect(items[0].data).toBeUndefined()
    expect(items[0].properties).toBeUndefined()
  })
})
