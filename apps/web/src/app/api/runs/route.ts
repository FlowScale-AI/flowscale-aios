import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions, tools } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import type { RunItem } from '@/features/canvases/api/getAllRunsList'

function toRunItem(
  ex: typeof executions.$inferSelect,
  tool: typeof tools.$inferSelect | undefined,
): RunItem {
  const outputs: { filename: string; url: string; content_type: string; label: string }[] = []
  if (ex.outputsJson) {
    try {
      const raw = JSON.parse(ex.outputsJson) as { filename: string; path?: string }[]
      for (const o of raw) {
        const destName = `${ex.id.slice(0, 8)}_${o.filename}`
        outputs.push({
          filename: o.filename,
          url: `/api/outputs/${ex.toolId}/${encodeURIComponent(destName)}`,
          content_type: 'image/png',
          label: o.filename,
        })
      }
    } catch { /* ignore */ }
  }

  const createdAt = new Date(ex.createdAt).toISOString()
  const completedAt = ex.completedAt ? new Date(ex.completedAt).toISOString() : createdAt

  return {
    _id: ex.promptId ?? ex.id,
    pod_id: 'local',
    cluster_id: 'local',
    team_id: 'local',
    project_id: 'local',
    workflow_id: `aios:${ex.toolId}`,
    group_id: 'STUDIO',
    status: ex.status,
    trigger_type: 'manual',
    inputs: [],
    canvas_id: null,
    output_metadata: [],
    outputs,
    error: ex.errorMessage ?? null,
    execution_time_ms: ex.completedAt ? ex.completedAt - ex.createdAt : null,
    started_at: createdAt,
    completed_at: completedAt,
    created_at: createdAt,
    updated_at: completedAt,
    container_id: '',
    prompt_id: ex.promptId ?? ex.id,
    progress: ex.status === 'completed' ? 100 : 0,
    can_regenerate: true,
    project_name: 'AIOS',
    workflow_name: tool?.name ?? ex.toolId,
    regenerations: [],
  }
}

export async function GET(req: NextRequest) {
  const db = getDb()
  const { searchParams } = new URL(req.url)
  const pageSize = parseInt(searchParams.get('page_size') ?? '12', 10)
  const pageNumber = parseInt(searchParams.get('page_number') ?? '1', 10)

  const allExecs = await db
    .select()
    .from(executions)
    .orderBy(desc(executions.createdAt))

  const allTools = await db.select().from(tools)
  const toolMap = new Map(allTools.map((t) => [t.id, t]))

  const items = allExecs
    .filter((ex) => ex.status === 'completed')
    .map((ex) => toRunItem(ex, toolMap.get(ex.toolId)))

  const total = items.length
  const start = (pageNumber - 1) * pageSize
  const page = items.slice(start, start + pageSize)

  return NextResponse.json({
    status: 'success',
    data: page,
    total,
    total_pages: Math.ceil(total / pageSize),
    page_size: pageSize,
    page_number: pageNumber,
  })
}
