import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getComfyUIPath, setComfyUIPath } from '@/lib/providerSettings'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const comfyuiPath = getComfyUIPath()
  return NextResponse.json({ comfyuiPath: comfyuiPath ?? null })
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { comfyuiPath } = (await req.json()) as { comfyuiPath: string }
  if (!comfyuiPath || typeof comfyuiPath !== 'string') {
    return NextResponse.json({ error: 'comfyuiPath required' }, { status: 400 })
  }

  setComfyUIPath(comfyuiPath.trim())
  return NextResponse.json({ ok: true, comfyuiPath: comfyuiPath.trim() })
}
