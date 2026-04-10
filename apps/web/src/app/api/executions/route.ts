import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions, tools } from '@/lib/db/schema'
import { desc, eq, and, type SQL } from 'drizzle-orm'
import { getRequestUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10), 100)
  const statusFilter = req.nextUrl.searchParams.get('status')
  const toolIdFilter = req.nextUrl.searchParams.get('toolId')

  const conditions: SQL[] = []
  if (statusFilter) {
    conditions.push(eq(executions.status, statusFilter))
  }
  if (toolIdFilter) {
    conditions.push(eq(executions.toolId, toolIdFilter))
  }

  const db = getDb()
  const rows = await db
    .select({
      execution: executions,
      toolName: tools.name,
    })
    .from(executions)
    .leftJoin(tools, eq(executions.toolId, tools.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(executions.createdAt))
    .limit(limit)

  return NextResponse.json(
    rows.map(({ execution, toolName }) => ({
      ...execution,
      toolName: toolName ?? 'Unknown Tool',
    }))
  )
}
