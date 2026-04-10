import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions, tools } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { getRequestUser } from '@/lib/auth'

/**
 * POST /api/tools/[id]/executions/enqueue
 *
 * Creates an execution record with status 'queued'.
 * The record persists in the DB so it survives page navigation.
 * The client-side batch queue dispatches it later via the main
 * POST /api/tools/[id]/executions endpoint.
 */
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id: toolId } = await params

  const [tool] = await db.select().from(tools).where(eq(tools.id, toolId))
  if (!tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 })

  const body = await req.json()
  const { inputs, seed } = body

  const currentUser = getRequestUser(req)
  const executionId = uuidv4()
  const resolvedSeed = seed ?? Math.floor(Math.random() * 2 ** 32)

  await db.insert(executions).values({
    id: executionId,
    toolId,
    userId: currentUser?.id ?? null,
    inputsJson: JSON.stringify({ ...inputs, seed: resolvedSeed }),
    workflowHash: tool.workflowHash,
    seed: resolvedSeed,
    status: 'queued',
    createdAt: Date.now(),
  })

  return NextResponse.json({ executionId, seed: resolvedSeed }, { status: 201 })
}
