import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions, tools } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { isValidComfyWorkflow, normalizeWorkflow, type ObjectInfoMap } from '@flowscale/workflow'

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id } = await params

  const rows = await db
    .select()
    .from(executions)
    .where(eq(executions.toolId, id))
    .orderBy(desc(executions.createdAt))
    .limit(100)

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id: toolId } = await params

  const [tool] = await db.select().from(tools).where(eq(tools.id, toolId))
  if (!tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 })
  if (!tool.comfyPort) return NextResponse.json({ error: 'No ComfyUI port configured for this tool' }, { status: 400 })

  const body = await req.json()
  const { inputs, comfyOrgApiKey } = body

  // Generate a random seed if not provided in inputs
  const seed = inputs?.seed ?? Math.floor(Math.random() * 2 ** 32)

  const executionId = uuidv4()
  const now = Date.now()
  const clientId = uuidv4()

  // Parse workflow, normalize to API format, and inject inputs.
  // Fetch /object_info from the local ComfyUI instance so we can resolve widget
  // params for custom nodes (beyond the static built-in table). If unreachable,
  // we fall back to the static table — execution still proceeds.
  const parsed = JSON.parse(tool.workflowJson)
  if (!isValidComfyWorkflow(parsed)) {
    return NextResponse.json({ error: 'Stored workflow is not a valid ComfyUI workflow' }, { status: 422 })
  }

  let objectInfoMap: ObjectInfoMap | undefined
  try {
    const infoRes = await fetch(`http://localhost:${tool.comfyPort}/object_info`, {
      signal: AbortSignal.timeout(3000),
    })
    if (infoRes.ok) objectInfoMap = await infoRes.json() as ObjectInfoMap
  } catch { /* ComfyUI unreachable — fall back to static table */ }

  const workflow = normalizeWorkflow(parsed, objectInfoMap) as Record<string, { inputs: Record<string, unknown> }>
  const schema = JSON.parse(tool.schemaJson) as Array<{
    nodeId: string; paramName: string; isInput: boolean; defaultValue?: unknown; enabled?: boolean
  }>

  for (const field of schema) {
    if (!field.isInput) continue
    if (field.enabled === false) continue
    if (!workflow[field.nodeId]) continue
    // Prefer provided input → fall back to schema default → leave workflow as-is
    let inputValue: unknown
    if (field.paramName === 'seed') {
      inputValue = seed
    } else {
      const provided = inputs?.[`${field.nodeId}__${field.paramName}`]
      // Treat 0 and '' as "not provided" — the canvas sends 0 for unconfigured number fields.
      // Falling back to defaultValue (or leaving the workflow's stored value) is safer.
      const isProvided = provided !== undefined && provided !== '' && provided !== 0
      inputValue = isProvided ? provided : field.defaultValue
    }
    if (inputValue !== undefined) {
      workflow[field.nodeId].inputs[field.paramName] = inputValue
    }
  }

  // Insert execution row
  await db.insert(executions).values({
    id: executionId,
    toolId,
    inputsJson: JSON.stringify({ ...inputs, seed }),
    workflowHash: tool.workflowHash,
    seed,
    status: 'running',
    createdAt: now,
  })

  // Queue the prompt via embedded ComfyUI proxy (non-blocking)
  const promptPayload: Record<string, unknown> = { prompt: workflow, client_id: clientId }
  if (comfyOrgApiKey) {
    promptPayload.extra_data = { api_key_comfy_org: comfyOrgApiKey }
  }
  const queueRes = await fetch(`http://localhost:${tool.comfyPort}/prompt`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(promptPayload),
  })

  if (!queueRes.ok) {
    let detail = ''
    let nodeErrors: Record<string, { errors: { details: string }[]; class_type: string }> | undefined
    try {
      const body = await queueRes.json()
      detail = body?.error?.message ?? JSON.stringify(body)
      nodeErrors = body?.node_errors
    } catch {
      try { detail = await queueRes.text() } catch { /* ignore */ }
    }

    const errorMessage = nodeErrors
      ? Object.entries(nodeErrors)
          .flatMap(([, n]) => n.errors.map((e) => `[${n.class_type}] ${e.details}`))
          .join('\n')
      : detail || 'Failed to queue prompt'

    await db.update(executions).set({ status: 'error', errorMessage, completedAt: Date.now() })
      .where(eq(executions.id, executionId))
    return NextResponse.json({ error: errorMessage, nodeErrors }, { status: 502 })
  }

  const { prompt_id: promptId } = (await queueRes.json()) as { prompt_id: string }
  await db.update(executions).set({ promptId }).where(eq(executions.id, executionId))

  return NextResponse.json({
    executionId,
    promptId,
    clientId,
    comfyPort: tool.comfyPort,
    seed,
  }, { status: 202 })
}
