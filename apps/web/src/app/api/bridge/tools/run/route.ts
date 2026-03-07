import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { installedApps, executions, tools } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseManifest } from '@/lib/appManifest'
import { getRegistryTool } from '@/lib/registry'
import { executeRegistryTool } from '@/lib/registry/executor'
import { getRequestUser } from '@/lib/auth'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    appId: string
    id: string
    inputs: Record<string, unknown>
    comfyPort?: number
  }
  const { appId, id: toolId, inputs, comfyPort } = body

  if (!appId || !toolId) {
    return NextResponse.json({ error: 'appId and id are required' }, { status: 400 })
  }

  const db = getDb()

  // Verify app is installed and has tools permission
  const [app] = await db.select().from(installedApps).where(eq(installedApps.id, appId))
  if (!app) return NextResponse.json({ error: 'App not found' }, { status: 404 })

  let manifest
  try {
    manifest = parseManifest(JSON.parse(app.manifestJson))
  } catch {
    return NextResponse.json({ error: 'Invalid app manifest' }, { status: 400 })
  }

  if (!manifest.permissions.includes('tools')) {
    return NextResponse.json({ error: 'App does not have tools permission' }, { status: 403 })
  }

  const executionId = uuidv4()
  const now = Date.now()

  // Try registry tool first
  const registryTool = getRegistryTool(toolId)
  if (registryTool) {
    const port = comfyPort ?? 8188

    // Create execution record
    await db.insert(executions).values({
      id: executionId,
      toolId,
      userId: user.id,
      inputsJson: JSON.stringify(inputs),
      workflowHash: registryTool.id,
      status: 'running',
      createdAt: now,
    })

    try {
      const result = await executeRegistryTool(registryTool, { comfyPort: port, inputs })

      await db
        .update(executions)
        .set({
          outputsJson: JSON.stringify(result.outputs),
          promptId: result.promptId,
          status: 'completed',
          completedAt: Date.now(),
        })
        .where(eq(executions.id, executionId))

      return NextResponse.json({
        executionId,
        toolId,
        status: 'completed',
        outputs: result.outputs,
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await db
        .update(executions)
        .set({ status: 'error', errorMessage: msg, completedAt: Date.now() })
        .where(eq(executions.id, executionId))

      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // Try custom (user-built) tool
  const [customTool] = await db.select().from(tools).where(eq(tools.id, toolId))
  if (!customTool) {
    return NextResponse.json({ error: `Tool not found: ${toolId}` }, { status: 404 })
  }

  // Custom tool execution: delegate to existing /api/tools/[id]/execute if it exists
  // For now return a not-implemented stub
  return NextResponse.json({ error: 'Custom tool bridge execution not yet implemented' }, { status: 501 })
}
