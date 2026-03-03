import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { canvases, canvasItems } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { Canvas } from '@/features/canvases/types'

function rowToCanvas(row: typeof canvases.$inferSelect): Canvas {
  return {
    _id: row.id,
    name: row.name,
    description: row.description,
    team_id: 'local',
    viewport: JSON.parse(row.viewportJson),
    settings: JSON.parse(row.settingsJson),
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
