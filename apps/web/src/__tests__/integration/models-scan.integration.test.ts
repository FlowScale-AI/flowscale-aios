import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, makeRequest } from './setup'
import type { TestDb } from './setup'
import * as schema from '../../lib/db/schema'

let db: TestDb
let scanResult: Array<{
  id: string; filename: string; path: string; type: string
  sizeBytes: number | null; comfyPort: number; scannedAt: number
}>

vi.mock('../../lib/db', () => ({ getDb: () => db }))
vi.mock('../../lib/modelScanner', () => ({ scanComfyModels: vi.fn(async () => scanResult) }))

import { POST as scanModels } from '../../app/api/models/scan/route'

const scanReq = (comfyPort: number) =>
  makeRequest('/api/models/scan', {
    method: 'POST',
    body: JSON.stringify({ comfyPort }),
    headers: { 'Content-Type': 'application/json' },
  })

const model = (comfyPort: number, id: string) => ({
  id, filename: 'shared.safetensors', path: 'checkpoints/shared.safetensors',
  type: 'checkpoint', sizeBytes: 100, comfyPort, scannedAt: 1,
})

describe('models scan upsert', () => {
  beforeEach(() => { db = createTestDb() })

  it('reconciles on path when the same model is re-scanned under a different port', async () => {
    // Scan under port A (id is sha256(port:filename), so port-scoped).
    scanResult = [model(41191, 'a:ckpt')]
    expect((await scanModels(scanReq(41191))).status).toBe(200)

    // Scan under port B — a shared models dir → same path, different id.
    // Must NOT 500 on the UNIQUE(path) constraint.
    scanResult = [model(41189, 'b:ckpt')]
    expect((await scanModels(scanReq(41189))).status).toBe(200)

    const rows = db.select().from(schema.models).all()
    expect(rows).toHaveLength(1)                       // UNIQUE(path) → one row
    expect(rows[0].path).toBe('checkpoints/shared.safetensors')
    expect(rows[0].comfyPort).toBe(41189)              // ownership moves to the latest scanner
  })
})
