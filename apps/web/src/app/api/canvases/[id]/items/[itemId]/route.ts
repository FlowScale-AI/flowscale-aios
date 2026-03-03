import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { canvasItems, canvases } from '@/lib/db/schema'
import { and, eq } from 'drizzle-orm'

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; itemId: string }> },
) {
  const { id, itemId } = await params
  const db = getDb()
  await db
    .delete(canvasItems)
    .where(and(eq(canvasItems.canvasId, id), eq(canvasItems.id, itemId)))
  await db
    .update(canvases)
    .set({ updatedAt: new Date().toISOString() })
    .where(eq(canvases.id, id))
  return new NextResponse(null, { status: 204 })
}
