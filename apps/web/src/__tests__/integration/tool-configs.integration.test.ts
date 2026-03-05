import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, makeRequest } from './setup'
import type { TestDb } from './setup'

let db: TestDb

vi.mock('../../lib/db', () => ({
  getDb: () => db,
}))

import { GET as getConfig, PUT as putConfig } from '../../app/api/tool-configs/[workflowId]/route'

describe('Tool configs integration', () => {
  beforeEach(() => {
    db = createTestDb()
  })

  const workflowId = 'wf-test-123'
  const sampleConfig = {
    inputs: { '1__text': { visible: true, label: 'Prompt' } },
    outputs: { '2__images': { visible: true } },
  }

  it('GET returns 204 when no config exists', async () => {
    const req = makeRequest(`/api/tool-configs/${workflowId}`)
    const res = await getConfig(req, { params: Promise.resolve({ workflowId }) })
    expect(res.status).toBe(204)
  })

  it('PUT creates a new config and GET retrieves it', async () => {
    const putReq = makeRequest(`/api/tool-configs/${workflowId}`, {
      method: 'PUT',
      body: JSON.stringify(sampleConfig),
      headers: { 'Content-Type': 'application/json' },
    })
    const putRes = await putConfig(putReq, { params: Promise.resolve({ workflowId }) })
    expect(putRes.status).toBe(204)

    const getReq = makeRequest(`/api/tool-configs/${workflowId}`)
    const getRes = await getConfig(getReq, { params: Promise.resolve({ workflowId }) })
    expect(getRes.status).toBe(200)
    const config = await getRes.json()
    expect(config.inputs['1__text'].label).toBe('Prompt')
  })

  it('PUT overwrites existing config (upsert)', async () => {
    // Create initial config
    const putReq1 = makeRequest(`/api/tool-configs/${workflowId}`, {
      method: 'PUT',
      body: JSON.stringify(sampleConfig),
      headers: { 'Content-Type': 'application/json' },
    })
    await putConfig(putReq1, { params: Promise.resolve({ workflowId }) })

    // Overwrite with new config
    const newConfig = { inputs: { '1__text': { visible: false, label: 'Hidden' } }, outputs: {} }
    const putReq2 = makeRequest(`/api/tool-configs/${workflowId}`, {
      method: 'PUT',
      body: JSON.stringify(newConfig),
      headers: { 'Content-Type': 'application/json' },
    })
    const putRes = await putConfig(putReq2, { params: Promise.resolve({ workflowId }) })
    expect(putRes.status).toBe(204)

    const getReq = makeRequest(`/api/tool-configs/${workflowId}`)
    const getRes = await getConfig(getReq, { params: Promise.resolve({ workflowId }) })
    const config = await getRes.json()
    expect(config.inputs['1__text'].visible).toBe(false)
    expect(config.inputs['1__text'].label).toBe('Hidden')
  })
})
