import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getComfyOrgApiKey, setComfyOrgApiKey } from '@/lib/providerSettings'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const key = getComfyOrgApiKey()
  return NextResponse.json({ configured: !!key })
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { key } = (await req.json()) as { key: string }
  setComfyOrgApiKey(typeof key === 'string' ? key.trim() : '')
  return NextResponse.json({ ok: true })
}
