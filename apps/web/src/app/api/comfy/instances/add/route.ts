import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { detectGpus } from '@/lib/gpu-detect'
import { getComfyInstances, setComfyInstances, type ComfyInstanceConfig } from '@/lib/providerSettings'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { gpuIndex?: unknown } | null
  const gpuIndex = typeof body?.gpuIndex === 'number' ? body.gpuIndex : Number(body?.gpuIndex)
  if (!Number.isInteger(gpuIndex) || gpuIndex < 0) {
    return NextResponse.json({ error: 'gpuIndex (non-negative integer) required' }, { status: 400 })
  }

  const gpus = detectGpus()
  const gpu = gpus.find((g) => g.index === gpuIndex)
  if (!gpu) {
    return NextResponse.json({ error: `No GPU found at index ${gpuIndex}` }, { status: 404 })
  }

  const existing = getComfyInstances()
  const instanceId = `gpu-${gpu.index}`

  if (existing.some((i) => i.id === instanceId)) {
    return NextResponse.json({ error: `Instance ${instanceId} already exists` }, { status: 409 })
  }

  const maxPort = existing.reduce((m, i) => Math.max(m, i.port), 41187)
  const newPort = maxPort + 1

  const devicePrefix = gpu.backend === 'rocm' ? 'rocm' : 'cuda'
  const newInstance: ComfyInstanceConfig = {
    id: instanceId,
    port: newPort,
    device: `${devicePrefix}:${gpu.index}`,
    label: `GPU ${gpu.index} — ${gpu.name}`,
    gpuName: gpu.name,
  }

  setComfyInstances([...existing, newInstance])

  return NextResponse.json({ instance: newInstance })
}
