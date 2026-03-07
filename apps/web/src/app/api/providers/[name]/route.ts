import { NextRequest, NextResponse } from 'next/server'
import {
  ALL_PROVIDER_NAMES,
  setProviderKey,
  deleteProviderKey,
  type ProviderName,
} from '@/lib/providerSettings'
import { getRequestUser } from '@/lib/auth'

type Params = { params: Promise<{ name: string }> }

export async function POST(req: NextRequest, { params }: Params) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'dev'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name } = await params
  if (!ALL_PROVIDER_NAMES.includes(name as ProviderName)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 })
  }

  const body = await req.json() as { key?: string }
  if (!body.key || typeof body.key !== 'string' || !body.key.trim()) {
    return NextResponse.json({ error: 'key is required' }, { status: 400 })
  }

  setProviderKey(name as ProviderName, body.key.trim())
  return NextResponse.json({ ok: true })
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'dev'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { name } = await params
  if (!ALL_PROVIDER_NAMES.includes(name as ProviderName)) {
    return NextResponse.json({ error: 'Unknown provider' }, { status: 404 })
  }

  deleteProviderKey(name as ProviderName)
  return NextResponse.json({ ok: true })
}
