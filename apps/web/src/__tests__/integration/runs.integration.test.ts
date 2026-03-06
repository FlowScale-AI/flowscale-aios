import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, makeRequest } from './setup'
import type { TestDb } from './setup'

let db: TestDb

vi.mock('../../lib/db', () => ({
  getDb: () => db,
}))

globalThis.fetch = vi.fn()

import { GET as getRuns } from '../../app/api/runs/route'
import { POST as createTool } from '../../app/api/tools/route'
import { getDb } from '../../lib/db'
import { executions } from '../../lib/db/schema'

describe('GET /api/runs (integration)', () => {
  let toolId: string

  beforeEach(async () => {
    db = createTestDb()

    const req = makeRequest('/api/tools', {
      method: 'POST',
      body: JSON.stringify({
        name: 'Runs Tool',
        description: 'test',
        workflowJson: JSON.stringify({ '1': { class_type: 'SaveImage', inputs: {} } }),
        workflowHash: 'runs-hash',
        schemaJson: JSON.stringify([]),
        layout: 'left-right',
        comfyPort: 8188,
      }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await createTool(req)
    const tool = await res.json()
    toolId = tool.id
  })

  function insertExecution(overrides: Record<string, unknown> = {}) {
    const id = `exec-${Math.random().toString(36).slice(2, 10)}`
    const now = Date.now()
    db.insert(executions).values({
      id,
      toolId,
      inputsJson: '{}',
      workflowHash: 'runs-hash',
      status: 'completed',
      createdAt: now,
      completedAt: now + 1000,
      outputsJson: JSON.stringify([{ filename: 'img.png' }]),
      ...overrides,
    }).run()
    return id
  }

  it('returns empty data when no executions', async () => {
    const req = makeRequest('/api/runs')
    const res = await getRuns(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.status).toBe('success')
    expect(data.data).toEqual([])
    expect(data.total).toBe(0)
  })

  it('returns only completed executions', async () => {
    insertExecution({ status: 'completed' })
    insertExecution({ status: 'running' })
    insertExecution({ status: 'error' })

    const req = makeRequest('/api/runs')
    const res = await getRuns(req)
    const data = await res.json()
    expect(data.total).toBe(1)
    expect(data.data.length).toBe(1)
  })

  it('paginates results correctly', async () => {
    for (let i = 0; i < 5; i++) {
      insertExecution({ createdAt: Date.now() + i * 100 })
    }

    const req1 = makeRequest('/api/runs?page_size=2&page_number=1')
    const res1 = await getRuns(req1)
    const data1 = await res1.json()
    expect(data1.data.length).toBe(2)
    expect(data1.total).toBe(5)
    expect(data1.total_pages).toBe(3)
    expect(data1.page_number).toBe(1)

    const req2 = makeRequest('/api/runs?page_size=2&page_number=3')
    const res2 = await getRuns(req2)
    const data2 = await res2.json()
    expect(data2.data.length).toBe(1)
  })

  it('maps execution to RunItem shape with outputs', async () => {
    const execId = insertExecution()

    const req = makeRequest('/api/runs?page_size=10')
    const res = await getRuns(req)
    const data = await res.json()

    const run = data.data[0]
    expect(run._id).toBeDefined()
    expect(run.status).toBe('completed')
    expect(run.workflow_name).toBe('Runs Tool')
    expect(run.outputs.length).toBe(1)
    expect(run.outputs[0].filename).toBe('img.png')
    expect(run.outputs[0].url).toContain(`/api/outputs/${toolId}/`)
    expect(run.progress).toBe(100)
    expect(run.can_regenerate).toBe(true)
  })

  it('handles executions with no outputs gracefully', async () => {
    insertExecution({ outputsJson: null })

    const req = makeRequest('/api/runs')
    const res = await getRuns(req)
    const data = await res.json()
    // null outputs → not 'completed' filter... actually status is still completed
    // but toRunItem handles null outputsJson
    expect(data.data[0].outputs).toEqual([])
  })
})
