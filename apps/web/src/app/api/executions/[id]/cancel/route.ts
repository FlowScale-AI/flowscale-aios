import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { inFlightControllers } from '@/lib/inferenceRegistry'

export async function POST(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: executionId } = await params

  const controller = inFlightControllers.get(executionId)
  if (controller) {
    controller.abort()
    return NextResponse.json({ cancelled: true })
  }

  // Execution may have already finished or isn't in this process — mark as error if still running
  const db = getDb()
  const [exec] = await db.select().from(executions).where(eq(executions.id, executionId))
  if (exec?.status === 'running') {
    await db.update(executions)
      .set({ status: 'error', errorMessage: 'Cancelled', completedAt: Date.now() })
      .where(eq(executions.id, executionId))
    return NextResponse.json({ cancelled: true })
  }

  return NextResponse.json({ cancelled: false, reason: 'Not in-flight' })
}
