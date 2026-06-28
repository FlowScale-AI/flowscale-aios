import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ──────────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getRequestUser: vi.fn(() => ({ id: 'user-1', role: 'admin' })),
}))

let _instances: unknown[] = []
vi.mock('@/lib/providerSettings', () => ({
  getComfyInstances: vi.fn(() => _instances),
  setComfyInstances: vi.fn((v: unknown[]) => { _instances = v }),
  getCustomScripts: vi.fn(() => []),
}))

import { POST } from '../../app/api/settings/comfy-instances/route'

const BASE_INSTANCE = { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0', gpuName: 'RTX 4090' }

function req(instances: unknown[]) {
  return new NextRequest('http://localhost/api/settings/comfy-instances', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ instances }),
  })
}

beforeEach(() => {
  _instances = [{ ...BASE_INSTANCE }]
})

describe('POST /api/settings/comfy-instances — customLabel', () => {
  it('sets customLabel when provided as a non-empty string', async () => {
    const res = await POST(req([{ id: 'gpu-0', customLabel: 'Image Gen' }]))
    expect(res.status).toBe(200)
    const saved = _instances as Array<{ id: string; customLabel?: string }>
    expect(saved[0].customLabel).toBe('Image Gen')
  })

  it('removes customLabel when set to null', async () => {
    _instances = [{ ...BASE_INSTANCE, customLabel: 'Old Label' }]
    const res = await POST(req([{ id: 'gpu-0', customLabel: null }]))
    expect(res.status).toBe(200)
    const saved = _instances as Array<{ id: string; customLabel?: string }>
    expect(saved[0].customLabel).toBeUndefined()
  })

  it('removes customLabel when set to empty string', async () => {
    _instances = [{ ...BASE_INSTANCE, customLabel: 'Old Label' }]
    const res = await POST(req([{ id: 'gpu-0', customLabel: '' }]))
    expect(res.status).toBe(200)
    const saved = _instances as Array<{ id: string; customLabel?: string }>
    expect(saved[0].customLabel).toBeUndefined()
  })

  it('preserves existing customLabel when not included in update', async () => {
    _instances = [{ ...BASE_INSTANCE, customLabel: 'Stable' }]
    // update only launchScriptId — omit customLabel entirely
    const res = await POST(req([{ id: 'gpu-0', launchScriptId: null }]))
    expect(res.status).toBe(200)
    const saved = _instances as Array<{ id: string; customLabel?: string }>
    expect(saved[0].customLabel).toBe('Stable')
  })

  it('does not modify instances not mentioned in the update', async () => {
    _instances = [
      { ...BASE_INSTANCE, customLabel: 'Keep Me' },
      { id: 'gpu-1', port: 41189, device: 'cuda:1', label: 'GPU 1' },
    ]
    await POST(req([{ id: 'gpu-1', customLabel: 'New Label' }]))
    const saved = _instances as Array<{ id: string; customLabel?: string }>
    expect(saved[0].customLabel).toBe('Keep Me')
    expect(saved[1].customLabel).toBe('New Label')
  })

  it('does not overwrite port, device, or label fields', async () => {
    const res = await POST(req([{ id: 'gpu-0', customLabel: 'X', port: 9999, device: 'cpu' } as never]))
    expect(res.status).toBe(200)
    const saved = _instances as Array<{ id: string; port: number; device: string }>
    expect(saved[0].port).toBe(41188)
    expect(saved[0].device).toBe('cuda:0')
  })
})
