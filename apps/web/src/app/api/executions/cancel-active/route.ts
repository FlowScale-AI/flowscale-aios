import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions } from '@/lib/db/schema'
import { eq, or } from 'drizzle-orm'
import { inFlightControllers } from '@/lib/inferenceRegistry'
import { trackExecEndById } from '@/lib/comfyAutoRoute'

/**
 * POST /api/executions/cancel-active
 *
 * Cancels all running and queued executions.
 * Aborts any in-flight inference requests and marks DB records as error.
 */
export async function POST(_req: NextRequest) {
  const db = getDb()

  // Find all running + queued executions
  const active = await db
    .select({ id: executions.id, status: executions.status })
    .from(executions)
    .where(or(eq(executions.status, 'running'), eq(executions.status, 'queued')))

  let cancelled = 0

  for (const exec of active) {
    // Abort in-flight controller if exists
    const controller = inFlightControllers.get(exec.id)
    if (controller) {
      controller.abort()
    }
    trackExecEndById(exec.id)

    await db.update(executions)
      .set({ status: 'error', errorMessage: 'Cancelled', completedAt: Date.now() })
      .where(eq(executions.id, exec.id))
    cancelled++
  }

  return NextResponse.json({ cancelled, total: active.length })
}
