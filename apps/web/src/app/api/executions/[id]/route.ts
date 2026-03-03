import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions, tools } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'

async function saveOutputsToDisk(
  outputsJson: string,
  comfyPort: number,
  toolId: string,
  executionId: string,
): Promise<void> {
  let outputs: { filename: string }[]
  try {
    outputs = JSON.parse(outputsJson)
  } catch {
    return
  }

  const toolDir = join(homedir(), '.flowscale', 'eios-outputs', toolId)
  await mkdir(toolDir, { recursive: true })

  await Promise.allSettled(
    outputs.map(async ({ filename }) => {
      try {
        const url = `http://localhost:${comfyPort}/view?filename=${encodeURIComponent(filename)}&subfolder=&type=output`
        const res = await fetch(url)
        if (!res.ok) return
        const buffer = Buffer.from(await res.arrayBuffer())
        const destName = `${executionId.slice(0, 8)}_${filename}`
        await writeFile(join(toolDir, destName), buffer)
      } catch {
        // Non-fatal
      }
    })
  )
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
  const [row] = await db.select().from(executions).where(eq(executions.id, id))
  if (!row) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Save outputs to disk when execution completes
  if (body.status === 'completed' && body.outputsJson) {
    const [tool] = await db.select().from(tools).where(eq(tools.id, row.toolId))
    if (tool?.comfyPort) {
      saveOutputsToDisk(body.outputsJson, tool.comfyPort, tool.id, id).catch(console.error)
    }
  }

  return NextResponse.json(row)
}
