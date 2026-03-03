import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { canvases } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import type { Canvas, CreateCanvasDTO } from '@/features/canvases/types'

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

export async function GET() {
  const db = getDb()
  const rows = await db.select().from(canvases).orderBy(desc(canvases.updatedAt))
  return NextResponse.json(rows.map(rowToCanvas))
}

export async function POST(req: NextRequest) {
  const db = getDb()
  const data: CreateCanvasDTO = await req.json()
  const now = new Date().toISOString()
  const id = crypto.randomUUID()

  const viewport = data.viewport ?? { x: 0, y: 0, zoom: 1 }
  const settings = data.settings ?? { grid_size: 8, snap_to_grid: false, background: '#ffffff' }

  await db.insert(canvases).values({
    id,
    name: data.name,
    description: data.description ?? '',
    viewportJson: JSON.stringify(viewport),
    settingsJson: JSON.stringify(settings),
    createdAt: now,
    updatedAt: now,
  })

  const canvas: Canvas = {
    _id: id,
    name: data.name,
    description: data.description ?? '',
    team_id: 'local',
    viewport,
    settings,
    created_at: now,
    updated_at: now,
    deleted_at: '',
  }
  return NextResponse.json(canvas, { status: 201 })
}
