import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { installedApps, executions, tools } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseManifest } from '@/lib/appManifest'
import { getRegistryTool } from '@/lib/registry'
import { executeRegistryTool } from '@/lib/registry/executor'
import { getRequestUser } from '@/lib/auth'
import { isValidComfyWorkflow, normalizeWorkflow, type ObjectInfoMap } from '@flowscale/workflow'
import { queuePrompt, getHistory } from '@/lib/comfyui-client'
import { v4 as uuidv4 } from 'uuid'
import { autoRouteComfyPort, trackExecStart, trackExecEndById } from '@/lib/comfyAutoRoute'

// ── Image input resolution ────────────────────────────────────────────────────
//
// Apps must never call ComfyUI directly. Instead they pass image inputs as:
//   - A base64 data URL ("data:image/png;base64,...")  →  uploaded to ComfyUI input dir
//   - An output reference ({ __comfy_output__: { filename, subfolder } })
//     →  fetched from ComfyUI output dir and re-uploaded to input dir for chaining
//
// Plain strings are passed through as-is (already a ComfyUI input filename).

type OutputRef = { __comfy_output__: { filename: string; subfolder: string } }

function isDataUrl(v: unknown): v is string {
  return typeof v === 'string' && v.startsWith('data:')
}

function isOutputRef(v: unknown): v is OutputRef {
  return typeof v === 'object' && v !== null && '__comfy_output__' in v
}

async function resolveImageInput(value: unknown, comfyPort: number): Promise<string> {
  const baseUrl = `http://127.0.0.1:${comfyPort}`

  if (isDataUrl(value)) {
    const [header, b64] = value.split(',')
    const mime = header.match(/data:([^;]+)/)?.[1] ?? 'image/png'
    const ext = mime.split('/')[1] ?? 'png'
    const buffer = Buffer.from(b64, 'base64')
    const filename = `upload_${Date.now()}.${ext}`

    const form = new FormData()
    form.append('image', new Blob([buffer], { type: mime }), filename)
    const res = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form })
    if (!res.ok) throw new Error('Failed to upload image to ComfyUI')
    const { name } = await res.json() as { name: string }
    return name
  }

  if (isOutputRef(value)) {
    const { filename, subfolder } = value.__comfy_output__
    const viewUrl = `${baseUrl}/view?filename=${encodeURIComponent(filename)}&type=output`
      + (subfolder ? `&subfolder=${encodeURIComponent(subfolder)}` : '')
    const fetchRes = await fetch(viewUrl)
    if (!fetchRes.ok) throw new Error(`Failed to fetch ComfyUI output: ${filename}`)
    const buf = await fetchRes.arrayBuffer()

    const form = new FormData()
    form.append('image', new Blob([buf], { type: 'image/png' }), filename)
    const uploadRes = await fetch(`${baseUrl}/upload/image`, { method: 'POST', body: form })
    if (!uploadRes.ok) throw new Error('Failed to re-upload image to ComfyUI')
    const { name } = await uploadRes.json() as { name: string }
    return name
  }

  return value as string
}

// ── Route ─────────────────────────────────────────────────────────────────────

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
    const port = comfyPort ?? await autoRouteComfyPort(8188)
    if (!port) return NextResponse.json({ error: 'No running ComfyUI instance available' }, { status: 503 })

    await db.insert(executions).values({
      id: executionId,
      toolId,
      userId: user.id,
      inputsJson: JSON.stringify(inputs),
      workflowHash: registryTool.id,
      status: 'running',
      createdAt: now,
    })
    trackExecStart(port, executionId)

    try {
      const result = await executeRegistryTool(registryTool, { comfyPort: port, inputs })
      trackExecEndById(executionId)

      await db
        .update(executions)
        .set({
          outputsJson: JSON.stringify(result.outputs),
          promptId: result.promptId,
          status: 'completed',
          completedAt: Date.now(),
        })
        .where(eq(executions.id, executionId))

      return NextResponse.json({ executionId, toolId, status: 'completed', outputs: result.outputs })
    } catch (err) {
      trackExecEndById(executionId)
      const msg = err instanceof Error ? err.message : String(err)
      await db
        .update(executions)
        .set({ status: 'error', errorMessage: msg, completedAt: Date.now() })
        .where(eq(executions.id, executionId))
      return NextResponse.json({ error: msg }, { status: 500 })
    }
  }

  // Custom (user-built) tool
  const [customTool] = await db.select().from(tools).where(eq(tools.id, toolId))
  if (!customTool) {
    return NextResponse.json({ error: `Tool not found: ${toolId}` }, { status: 404 })
  }

  // Server-side auto-routing for custom tools too
  const customPort = comfyPort ?? await autoRouteComfyPort(customTool.comfyPort)
  if (!customPort) {
    return NextResponse.json({ error: 'No running ComfyUI instance available' }, { status: 503 })
  }

  const baseUrl = `http://127.0.0.1:${customPort}`

  // Resolve image inputs (data URLs and output refs) server-side before workflow injection
  const resolvedInputs: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(inputs ?? {})) {
    if (isDataUrl(value) || isOutputRef(value)) {
      try {
        resolvedInputs[key] = await resolveImageInput(value, customPort)
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Image resolution failed'
        return NextResponse.json({ error: msg }, { status: 400 })
      }
    } else {
      resolvedInputs[key] = value
    }
  }

  // Normalize workflow and inject resolved inputs
  const parsed = JSON.parse(customTool.workflowJson)
  if (!isValidComfyWorkflow(parsed)) {
    return NextResponse.json({ error: 'Invalid workflow stored for this tool' }, { status: 422 })
  }

  let objectInfoMap: ObjectInfoMap | undefined
  try {
    const infoRes = await fetch(`${baseUrl}/object_info`, { signal: AbortSignal.timeout(3000) })
    if (infoRes.ok) objectInfoMap = await infoRes.json() as ObjectInfoMap
  } catch { /* fall back to static table */ }

  const workflow = normalizeWorkflow(parsed, objectInfoMap) as Record<string, { inputs: Record<string, unknown> }>
  const schema = JSON.parse(customTool.schemaJson) as Array<{
    nodeId: string; paramName: string; isInput: boolean; defaultValue?: unknown; enabled?: boolean
  }>

  for (const field of schema) {
    if (!field.isInput || field.enabled === false || !workflow[field.nodeId]) continue
    const provided = resolvedInputs[`${field.nodeId}__${field.paramName}`]
    const isProvided = provided !== undefined && provided !== '' && provided !== 0
    const value = isProvided ? provided : field.defaultValue
    if (value !== undefined) workflow[field.nodeId].inputs[field.paramName] = value
  }

  // Create execution record
  const customExecutionId = uuidv4()
  const clientId = uuidv4()

  await db.insert(executions).values({
    id: customExecutionId,
    toolId,
    userId: user.id,
    inputsJson: JSON.stringify(inputs),
    workflowHash: customTool.workflowHash,
    status: 'running',
    createdAt: Date.now(),
  })
  trackExecStart(customPort, customExecutionId)

  // Queue prompt
  let promptId: string
  try {
    promptId = await queuePrompt(workflow, clientId, baseUrl)
  } catch (err) {
    trackExecEndById(customExecutionId)
    const msg = err instanceof Error ? err.message : 'Failed to queue prompt'
    await db.update(executions).set({ status: 'error', errorMessage: msg, completedAt: Date.now() })
      .where(eq(executions.id, customExecutionId))
    return NextResponse.json({ error: msg }, { status: 502 })
  }

  await db.update(executions).set({ promptId }).where(eq(executions.id, customExecutionId))

  // Poll server-side so the SDK call resolves with outputs
  const maxWait = 300_000
  const started = Date.now()

  while (Date.now() - started < maxWait) {
    await new Promise((r) => setTimeout(r, 1000))

    let history: Record<string, unknown>
    try {
      history = await getHistory(promptId, baseUrl)
    } catch { continue }

    const entry = history[promptId] as {
      status?: { completed?: boolean }
      outputs?: Record<string, { images?: { filename: string; subfolder: string }[] }>
    } | undefined

    if (!entry?.status?.completed) continue

    trackExecEndById(customExecutionId)

    const outputs: Array<{ kind: string; filename: string; subfolder: string; path: string }> = []
    for (const nodeOut of Object.values(entry.outputs ?? {})) {
      for (const img of nodeOut.images ?? []) {
        const path = `/api/comfy/${customPort}/view?filename=${encodeURIComponent(img.filename)}&type=output`
          + (img.subfolder ? `&subfolder=${encodeURIComponent(img.subfolder)}` : '')
        outputs.push({ kind: 'image', filename: img.filename, subfolder: img.subfolder ?? '', path })
      }
    }

    await db.update(executions).set({
      status: 'completed',
      outputsJson: JSON.stringify(outputs),
      completedAt: Date.now(),
    }).where(eq(executions.id, customExecutionId))

    return NextResponse.json({ executionId: customExecutionId, toolId, status: 'completed', outputs })
  }

  trackExecEndById(customExecutionId)
  await db.update(executions).set({ status: 'error', errorMessage: 'Execution timed out', completedAt: Date.now() })
    .where(eq(executions.id, customExecutionId))
  return NextResponse.json({ error: 'Execution timed out' }, { status: 504 })
}
