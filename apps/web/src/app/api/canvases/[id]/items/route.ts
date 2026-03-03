import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { canvasItems, canvases } from '@/lib/db/schema'
import { eq, sql } from 'drizzle-orm'
import type { CanvasItem } from '@/features/canvases/types'

function rowToItem(row: typeof canvasItems.$inferSelect): CanvasItem {
  return {
    _id: row.id,
    type: row.type,
    position: JSON.parse(row.positionJson),
    z_index: row.zIndex,
    locked: row.locked === 1,
    hidden: row.hidden === 1,
    data: row.dataJson ? JSON.parse(row.dataJson) : undefined,
    properties: row.propertiesJson ? JSON.parse(row.propertiesJson) : undefined,
  }
}

function itemToValues(canvasId: string, item: CanvasItem) {
  return {
    id: item._id,
    canvasId,
    type: item.type,
    positionJson: JSON.stringify(item.position),
    zIndex: item.z_index,
    locked: item.locked ? 1 : 0,
    hidden: item.hidden ? 1 : 0,
    dataJson: item.data ? JSON.stringify(item.data) : null,
    propertiesJson: item.properties ? JSON.stringify(item.properties) : null,
  }
}

async function touchCanvas(canvasId: string) {
  const db = getDb()
  await db
    .update(canvases)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(canvases.id, canvasId))
}

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const rows = await db.select().from(canvasItems).where(eq(canvasItems.canvasId, id))
  return NextResponse.json(rows.map(rowToItem))
}

// POST: upsert new items (append)
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const { items }: { items: CanvasItem[] } = await req.json()

  for (const item of items) {
    await db
      .insert(canvasItems)
      .values(itemToValues(id, item))
      .onConflictDoUpdate({
        target: [canvasItems.canvasId, canvasItems.id],
        set: {
          type: sql`excluded.type`,
          positionJson: sql`excluded.position_json`,
          zIndex: sql`excluded.z_index`,
          locked: sql`excluded.locked`,
          hidden: sql`excluded.hidden`,
          dataJson: sql`excluded.data_json`,
          propertiesJson: sql`excluded.properties_json`,
        },
      })
  }

  await touchCanvas(id)
  return new NextResponse(null, { status: 204 })
}

// PATCH: replace all items for this canvas
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const db = getDb()
  const { items }: { items: CanvasItem[] } = await req.json()

  // Delete all existing items then re-insert
  await db.delete(canvasItems).where(eq(canvasItems.canvasId, id))
  if (items.length > 0) {
    await db.insert(canvasItems).values(items.map((item) => itemToValues(id, item)))
  }

  await touchCanvas(id)
  return new NextResponse(null, { status: 204 })
}
