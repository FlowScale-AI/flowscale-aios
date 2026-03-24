import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { cancelTraining } from '@/lib/trainingExecution'

export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; execId: string }> },
) {
  const { execId } = await params
  const db = getDb()

  const [exec] = await db.select().from(executions).where(eq(executions.id, execId))
  if (!exec) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  if (exec.status !== 'running') return NextResponse.json({ error: 'Not running' }, { status: 400 })

  const metadata = exec.metadataJson ? JSON.parse(exec.metadataJson) as { jobId: string; pluginId: string } : null
  if (!metadata) return NextResponse.json({ error: 'No training metadata' }, { status: 400 })

  try {
    await cancelTraining(metadata.pluginId, metadata.jobId)
    return NextResponse.json({ status: 'cancelling' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Cancel failed'
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
