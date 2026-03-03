import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { toolConfigs } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import type { ToolConfig } from '@/features/canvases/types'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const { workflowId } = await params
  const db = getDb()
  const [row] = await db.select().from(toolConfigs).where(eq(toolConfigs.workflowId, workflowId))
  if (!row) return new NextResponse(null, { status: 204 })
  return NextResponse.json(JSON.parse(row.configJson) as ToolConfig)
}

export async function PUT(
  req: NextRequest,
  { params }: { params: Promise<{ workflowId: string }> },
) {
  const { workflowId } = await params
  const db = getDb()
  const config: ToolConfig = await req.json()

  await db
    .insert(toolConfigs)
    .values({ workflowId, configJson: JSON.stringify(config) })
    .onConflictDoUpdate({
      target: toolConfigs.workflowId,
      set: { configJson: JSON.stringify(config) },
    })

  return new NextResponse(null, { status: 204 })
}
