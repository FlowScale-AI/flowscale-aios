import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions, tools } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { trackExecEndById } from '@/lib/comfyAutoRoute'

type OutputItem = { filename?: string; subfolder?: string; kind?: string; path?: string; text?: string }

async function saveOutputsToDisk(
  outputsJson: string,
  comfyPort: number,
  toolId: string,
  executionId: string,
): Promise<OutputItem[]> {
  let outputs: OutputItem[]
  try {
    outputs = JSON.parse(outputsJson)
  } catch {
    return []
  }

  const toolDir = join(homedir(), '.flowscale', 'aios-outputs', toolId)
  await mkdir(toolDir, { recursive: true })

  const results = await Promise.allSettled(
    outputs.map(async (item) => {
      if (!item.filename) return item
      try {
        const subfolder = item.subfolder ?? ''
        const url = `http://localhost:${comfyPort}/view?filename=${encodeURIComponent(item.filename)}&subfolder=${encodeURIComponent(subfolder)}&type=output`
        const res = await fetch(url)
        if (!res.ok) return item
        const buffer = Buffer.from(await res.arrayBuffer())
        const destName = `${executionId.slice(0, 8)}_${item.filename}`
        await writeFile(join(toolDir, destName), buffer)
        return { ...item, path: `/api/outputs/${toolId}/${destName}` }
      } catch {
        return item
      }
    })
  )

  return results.map((r, i) => r.status === 'fulfilled' ? r.value : outputs[i])
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id } = await params
  const [row] = await db.select().from(executions).where(eq(executions.id, id))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id } = await params
  const body = await req.json()

  const allowed = ['outputsJson', 'status', 'errorMessage', 'completedAt', 'metadataJson']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields' }, { status: 400 })
  }

  await db.update(executions).set(updates).where(eq(executions.id, id))

  // Release auto-route tracking when execution finishes
  if (body.status === 'completed' || body.status === 'error') {
    trackExecEndById(id)
  }

  // Save outputs to disk when execution completes, then update outputsJson with local paths
  if (body.status === 'completed' && body.outputsJson) {
    const [exec] = await db.select().from(executions).where(eq(executions.id, id))
    if (exec) {
      const [tool] = await db.select().from(tools).where(eq(tools.id, exec.toolId))
      if (tool?.comfyPort) {
        try {
          const saved = await saveOutputsToDisk(body.outputsJson, tool.comfyPort, tool.id, id)
          await db.update(executions).set({ outputsJson: JSON.stringify(saved) }).where(eq(executions.id, id))
        } catch (err) {
          console.error('saveOutputsToDisk failed', err)
        }
      }
    }
  }

  // Always re-read after all updates are done so the response reflects final state
  const [row] = await db.select().from(executions).where(eq(executions.id, id))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(row)
}
