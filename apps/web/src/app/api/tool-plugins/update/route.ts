import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { getRequestUser } from '@/lib/auth'
import { updatePluginFromSource } from '@/lib/toolPlugins'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { toolId } = await req.json()
  if (!toolId || typeof toolId !== 'string') {
    return NextResponse.json({ error: 'Missing toolId' }, { status: 400 })
  }

  try {
    const db = getDb()
    const tool = await updatePluginFromSource(toolId, db)
    return NextResponse.json(tool)
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Update failed'
    return NextResponse.json({ error: message }, { status: 400 })
  }
}
