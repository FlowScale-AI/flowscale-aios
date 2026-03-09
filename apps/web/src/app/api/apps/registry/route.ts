import { NextRequest, NextResponse } from 'next/server'
import { searchRegistry } from '@/lib/registry/appRegistry'
import { getRequestUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { searchParams } = req.nextUrl
  const q = searchParams.get('q') ?? undefined
  const category = searchParams.get('category') ?? undefined
  return NextResponse.json(searchRegistry(q, category))
}
