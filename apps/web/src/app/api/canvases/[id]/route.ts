import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { canvases, canvasItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getRequestUser } from '@/lib/auth'
import type { Canvas } from '@/features/canvases/types'

function rowToCanvas(row: typeof canvases.$inferSelect): Canvas {
  return {
    _id: row.id,
    name: row.name,
    description: row.description,
    team_id: 'local',
    viewport: JSON.parse(row.viewportJson),
    settings: JSON.parse(row.settingsJson),
    is_shared: row.isShared === 1,
    created_at: row.createdAt,
    updated_at: row.updatedAt,
    deleted_at: '',
  }
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const [row] = await db.select().from(canvases).where(eq(canvases.id, id))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rowToCanvas(row))
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  const body = await req.json()
  const db = getDb()

  const updates: Partial<typeof canvases.$inferInsert> = {}
  if (typeof body.is_shared === 'boolean') {
    updates.isShared = body.is_shared ? 1 : 0
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  updates.updatedAt = new Date().toISOString()

  const [row] = await db
    .update(canvases)
    .set(updates)
    .where(eq(canvases.id, id))
    .returning()

  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(rowToCanvas(row))
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  // canvas_items cascade delete via FK
  await db.delete(canvases).where(eq(canvases.id, id))
  return new NextResponse(null, { status: 204 })
}
