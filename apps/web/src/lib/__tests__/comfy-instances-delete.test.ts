import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks ──────────────────────────────────────────────────────────────────

const { mockGetComfyInstances, mockSetComfyInstances, mockGetInstanceStatus, mockStopInstance } = vi.hoisted(() => ({
  mockGetComfyInstances: vi.fn(),
  mockSetComfyInstances: vi.fn(),
  mockGetInstanceStatus: vi.fn(),
  mockStopInstance: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getRequestUser: vi.fn(() => ({ id: 'user-1', role: 'admin' })),
}))

vi.mock('@/lib/providerSettings', () => ({
  getComfyInstances: mockGetComfyInstances,
  setComfyInstances: mockSetComfyInstances,
}))

vi.mock('@/lib/comfyui-manager', () => ({
  getInstanceStatus: mockGetInstanceStatus,
  stopInstance: mockStopInstance,
}))

import { getRequestUser } from '@/lib/auth'
import { DELETE } from '../../app/api/comfy/instances/[id]/route'

const INSTANCES = [
  { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0' },
  { id: 'gpu-1', port: 41189, device: 'cuda:1', label: 'GPU 1' },
]

function req(id: string) {
  return new NextRequest(`http://localhost/api/comfy/instances/${id}`, { method: 'DELETE' })
}

function params(id: string) {
  return { params: Promise.resolve({ id }) }
}

beforeEach(() => {
  mockGetComfyInstances.mockReturnValue([...INSTANCES])
  mockGetInstanceStatus.mockReturnValue({ alive: false })
  mockStopInstance.mockReset()
  vi.mocked(getRequestUser).mockReturnValue({ id: 'user-1', role: 'admin' } as never)
})

describe('DELETE /api/comfy/instances/[id]', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getRequestUser).mockReturnValue(null as never)
    const res = await DELETE(req('gpu-0'), params('gpu-0'))
    expect(res.status).toBe(401)
  })

  it('returns 404 for unknown instance id', async () => {
    const res = await DELETE(req('gpu-99'), params('gpu-99'))
    expect(res.status).toBe(404)
    expect((await res.json()).error).toMatch(/not found/)
  })

  it('removes the instance and returns { ok: true }', async () => {
    const res = await DELETE(req('gpu-0'), params('gpu-0'))
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
    const saved = mockSetComfyInstances.mock.calls[0][0] as Array<{ id: string }>
    expect(saved).toHaveLength(1)
    expect(saved[0].id).toBe('gpu-1')
  })

  it('does not call stopInstance when instance is not alive', async () => {
    mockGetInstanceStatus.mockReturnValue({ alive: false })
    await DELETE(req('gpu-0'), params('gpu-0'))
    expect(mockStopInstance).not.toHaveBeenCalled()
  })

  it('calls stopInstance before removal when instance is alive', async () => {
    mockGetInstanceStatus.mockReturnValue({ alive: true })
    await DELETE(req('gpu-0'), params('gpu-0'))
    expect(mockStopInstance).toHaveBeenCalledWith('gpu-0')
    const saved = mockSetComfyInstances.mock.calls[0][0] as Array<{ id: string }>
    expect(saved.find(i => i.id === 'gpu-0')).toBeUndefined()
  })
})
