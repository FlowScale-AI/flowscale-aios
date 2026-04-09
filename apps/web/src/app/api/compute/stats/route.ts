import { NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions } from '@/lib/db/schema'
import { sql, and, gte, eq } from 'drizzle-orm'

export async function GET() {
  try {
    const db = getDb()
    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).getTime()

    const result = db
      .select({
        localJobs: sql<number>`COUNT(CASE WHEN ${executions.comfyPort} IS NULL OR ${executions.comfyPort} < 50000 THEN 1 END)`,
        cloudJobs: sql<number>`COUNT(CASE WHEN ${executions.comfyPort} >= 50000 THEN 1 END)`,
        totalJobs: sql<number>`COUNT(*)`,
      })
      .from(executions)
      .where(
        and(
          eq(executions.status, 'completed'),
          gte(executions.createdAt, monthStart)
        )
      )
      .get()

    return NextResponse.json({
      localJobs: result?.localJobs ?? 0,
      cloudJobs: result?.cloudJobs ?? 0,
      totalJobs: result?.totalJobs ?? 0,
      cloudCost: null,
    })
  } catch (err) {
    console.error('Failed to get compute stats:', err)
    return NextResponse.json(
      { localJobs: 0, cloudJobs: 0, totalJobs: 0, cloudCost: null },
      { status: 500 }
    )
  }
}
