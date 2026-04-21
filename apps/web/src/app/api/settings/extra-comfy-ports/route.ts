import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getExtraComfyPorts, setExtraComfyPorts } from '@/lib/providerSettings'
import { WELL_KNOWN_COMFY_PORTS } from '@/lib/comfy-probe'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  return NextResponse.json({
    ports: getExtraComfyPorts(),
    wellKnown: [...WELL_KNOWN_COMFY_PORTS],
  })
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { ports?: unknown } | null
  if (!body || !Array.isArray(body.ports)) {
    return NextResponse.json({ error: 'ports array required' }, { status: 400 })
  }
  const numeric = body.ports.map((p) => Number(p))
  if (numeric.some((p) => !Number.isInteger(p) || p < 1024 || p > 65535)) {
    return NextResponse.json({ error: 'ports must be integers in 1024–65535' }, { status: 400 })
  }
  setExtraComfyPorts(numeric)
  return NextResponse.json({ ports: getExtraComfyPorts() })
}
