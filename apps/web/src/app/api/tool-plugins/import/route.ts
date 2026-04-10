import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequestUser } from '@/lib/auth'
import { importPlugin } from '@/lib/toolPlugins'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { source } = await req.json()
  if (!source || typeof source !== 'string') {
    return NextResponse.json({ error: 'Missing source (local path or GitHub URL)' }, { status: 400 })
  }

  try {
    const db = getDb()
    const tool = await importPlugin(source.trim(), db)
    return NextResponse.json(tool, { status: 201 })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Import failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
