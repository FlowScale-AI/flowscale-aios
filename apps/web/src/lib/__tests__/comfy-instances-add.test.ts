import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ── Mocks (vi.hoisted keeps refs available in vi.mock factories) ────────────

const { mockDetectGpus, mockGetComfyInstances, mockSetComfyInstances } = vi.hoisted(() => ({
  mockDetectGpus: vi.fn(),
  mockGetComfyInstances: vi.fn(),
  mockSetComfyInstances: vi.fn(),
}))

vi.mock('@/lib/auth', () => ({
  getRequestUser: vi.fn(() => ({ id: 'user-1', role: 'admin' })),
}))

vi.mock('@/lib/gpu-detect', () => ({
  detectGpus: mockDetectGpus,
}))

vi.mock('@/lib/providerSettings', () => ({
  getComfyInstances: mockGetComfyInstances,
  setComfyInstances: mockSetComfyInstances,
}))

import { getRequestUser } from '@/lib/auth'
import { POST } from '../../app/api/comfy/instances/add/route'

const GPU_NVIDIA = { index: 0, name: 'RTX 4090', vramMB: 24576, backend: 'cuda' }
const GPU_AMD    = { index: 1, name: 'RX 7900 XTX', vramMB: 24576, backend: 'rocm' }

function req(body: unknown) {
  return new NextRequest('http://localhost/api/comfy/instances/add', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

beforeEach(() => {
  mockDetectGpus.mockReturnValue([GPU_NVIDIA, GPU_AMD])
  mockGetComfyInstances.mockReturnValue([])
  mockSetComfyInstances.mockReset()
  vi.mocked(getRequestUser).mockReturnValue({ id: 'user-1', role: 'admin' } as never)
})

describe('POST /api/comfy/instances/add', () => {
  it('returns 401 when unauthenticated', async () => {
    vi.mocked(getRequestUser).mockReturnValue(null as never)
    const res = await POST(req({ gpuIndex: 0 }))
    expect(res.status).toBe(401)
  })

  it('returns 400 when gpuIndex is missing', async () => {
    const res = await POST(req({}))
    expect(res.status).toBe(400)
  })

  it('returns 400 when gpuIndex is negative', async () => {
    const res = await POST(req({ gpuIndex: -1 }))
    expect(res.status).toBe(400)
  })

  it('returns 400 when gpuIndex is a float', async () => {
    const res = await POST(req({ gpuIndex: 0.5 }))
    expect(res.status).toBe(400)
  })

  it('returns 404 when GPU not found at given index', async () => {
    const res = await POST(req({ gpuIndex: 99 }))
    expect(res.status).toBe(404)
  })

  it('returns 409 when instance for that GPU already exists', async () => {
    mockGetComfyInstances.mockReturnValue([
      { id: 'gpu-0', port: 41188, device: 'cuda:0', label: 'GPU 0' },
    ])
    const res = await POST(req({ gpuIndex: 0 }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/already exists/)
  })

  it('creates NVIDIA instance with cuda device and correct port', async () => {
    mockGetComfyInstances.mockReturnValue([
      { id: 'cpu', port: 41188, device: 'cpu', label: 'CPU' },
    ])
    const res = await POST(req({ gpuIndex: 0 }))
    expect(res.status).toBe(200)
    const { instance } = await res.json()
    expect(instance.id).toBe('gpu-0')
    expect(instance.device).toBe('cuda:0')
    expect(instance.port).toBe(41189)
    expect(instance.gpuName).toBe('RTX 4090')
    expect(mockSetComfyInstances).toHaveBeenCalledOnce()
  })

  it('creates AMD instance with rocm device', async () => {
    const res = await POST(req({ gpuIndex: 1 }))
    expect(res.status).toBe(200)
    const { instance } = await res.json()
    expect(instance.device).toBe('rocm:1')
    expect(instance.gpuName).toBe('RX 7900 XTX')
  })

  it('assigns port = max(existing ports) + 1', async () => {
    mockGetComfyInstances.mockReturnValue([
      { id: 'gpu-0', port: 41195, device: 'cuda:0', label: 'GPU 0' },
    ])
    const res = await POST(req({ gpuIndex: 1 }))
    expect(res.status).toBe(200)
    expect((await res.json()).instance.port).toBe(41196)
  })

  it('returns 409 when port would exceed 65535', async () => {
    mockGetComfyInstances.mockReturnValue([
      { id: 'cpu', port: 65535, device: 'cpu', label: 'CPU' },
    ])
    const res = await POST(req({ gpuIndex: 0 }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toMatch(/65535/)
  })

  it('accepts string gpuIndex that coerces to a valid integer', async () => {
    const res = await POST(req({ gpuIndex: '0' }))
    expect(res.status).toBe(200)
  })
})
