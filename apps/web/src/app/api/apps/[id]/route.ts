import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { installedApps } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseManifest } from '@/lib/appManifest'
import { getRequestUser } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const db = getDb()
  const [row] = await db.select().from(installedApps).where(eq(installedApps.id, id))

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  try {
    const manifest = parseManifest(JSON.parse(row.manifestJson))
    return NextResponse.json({ ...row, manifest })
  } catch (err) {
    return NextResponse.json({ ...row, manifest: null, manifestError: String(err) })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'dev'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const db = getDb()
  const [row] = await db.select().from(installedApps).where(eq(installedApps.id, id))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  await db.delete(installedApps).where(eq(installedApps.id, id))
  return NextResponse.json({ ok: true })
}
