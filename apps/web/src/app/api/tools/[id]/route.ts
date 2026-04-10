import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { tools } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { existsSync, rmSync } from 'fs'
import { getPluginDir } from '@/lib/toolPlugins'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id } = await params
  const [tool] = await db.select().from(tools).where(eq(tools.id, id))
  if (!tool) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(tool)
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id } = await params
  const body = await req.json()

  const allowed = ['name', 'description', 'outputDir', 'comfyPort', 'layout', 'schemaJson']
  const updates: Record<string, unknown> = {}
  for (const key of allowed) {
    if (key in body) updates[key] = body[key]
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: 'No valid fields to update' }, { status: 400 })
  }

  await db.update(tools).set(updates).where(eq(tools.id, id))
  const [tool] = await db.select().from(tools).where(eq(tools.id, id))
  if (!tool) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json(tool)
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id } = await params

  // Check if this is an API-engine tool with a plugin directory
  const [tool] = await db.select().from(tools).where(eq(tools.id, id))
  if (tool?.engine === 'api') {
    // Derive plugin ID from workflowJson (stores { engine, model, pluginId })
    let pluginId: string | undefined
    try {
      const wf = typeof tool.workflowJson === 'string' ? JSON.parse(tool.workflowJson) : tool.workflowJson
      pluginId = wf?.pluginId
    } catch { /* ignore */ }

    if (pluginId) {
      const pluginDir = getPluginDir(pluginId)
      if (existsSync(pluginDir)) {
        rmSync(pluginDir, { recursive: true, force: true })
      }
    }
  }

  await db.delete(tools).where(eq(tools.id, id))
  return new NextResponse(null, { status: 204 })
}
