import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions, tools, models } from '@/lib/db/schema'
import { sql } from 'drizzle-orm'
import { getRequestUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()

  // Count executions by status
  const execCounts = db
    .select({ status: executions.status, count: sql<number>`count(*)` })
    .from(executions)
    .groupBy(executions.status)
    .all()

  const statusMap: Record<string, number> = {}
  for (const row of execCounts) {
    statusMap[row.status] = row.count
  }

  // Count tools
  const toolCount = db.select({ count: sql<number>`count(*)` }).from(tools).get()

  // Count models
  let modelCount = { count: 0 }
  try {
    modelCount = db.select({ count: sql<number>`count(*)` }).from(models).get() ?? { count: 0 }
  } catch {
    // models table may not exist yet
  }

  return NextResponse.json({
    runningJobs: statusMap['running'] ?? 0,
    completedJobs: statusMap['completed'] ?? 0,
    failedJobs: statusMap['error'] ?? 0,
    toolsInstalled: toolCount?.count ?? 0,
    modelsAvailable: modelCount?.count ?? 0,
  })
}
