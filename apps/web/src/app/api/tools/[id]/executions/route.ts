import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions, tools, users } from '@/lib/db/schema'
import { eq, desc } from 'drizzle-orm'
import { v4 as uuidv4 } from 'uuid'
import { isValidComfyWorkflow, normalizeWorkflow, type ObjectInfoMap } from '@flowscale/workflow'
import { getRequestUser } from '@/lib/auth'
import { mkdirSync, writeFileSync, mkdirSync as mkdirSyncFs, writeFileSync as writeFileSyncFs } from 'fs'
import { mkdir, writeFile } from 'fs/promises'
import { join } from 'path'
import { homedir } from 'os'
import { inFlightControllers } from '@/lib/inferenceRegistry'
import { getHistory } from '@/lib/comfyui-client'
import { getComfyOrgApiKey as getComfyOrgApiKeyServer } from '@/lib/providerSettings'

type OutputItem = { filename?: string; subfolder?: string; kind?: string; path?: string; text?: string }

async function saveComfyOutputsToDisk(
  outputs: OutputItem[],
  comfyPort: number,
  toolId: string,
  executionId: string,
): Promise<OutputItem[]> {
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
    }),
  )

  return results.map((r, i) => (r.status === 'fulfilled' ? r.value : outputs[i]))
}

const API_OUTPUTS_DIR = join(homedir(), '.flowscale', 'aios-outputs')

/**
 * Make a POST request to the inference server with NO body/idle timeout.
 *
 * Node.js `fetch` (undici) has a hard-coded 300s (5 min) body timeout that
 * cannot be configured. Slow inference (e.g. 10–15 min on MPS) exceeds this,
 * causing "fetch failed". Using `http.request` avoids the timeout entirely.
 */
function inferencePost(
  port: number,
  body: Record<string, unknown>,
  signal: AbortSignal,
): Promise<{ ok: boolean; status: number; body: string }> {
  const http = require('http') as typeof import('http')
  const payload = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: '/generate',
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(payload),
        },
        // No socket/response timeout — we wait as long as the model needs
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf-8')
          resolve({ ok: res.statusCode! >= 200 && res.statusCode! < 300, status: res.statusCode!, body: text })
        })
        res.on('error', reject)
      },
    )

    req.on('error', reject)

    // Respect the AbortSignal (user cancel / 30-min safety net)
    const onAbort = () => { req.destroy(new Error('AbortError')); reject(new Error('AbortError')) }
    if (signal.aborted) { onAbort(); return }
    signal.addEventListener('abort', onAbort, { once: true })
    req.on('close', () => signal.removeEventListener('abort', onAbort))

    req.write(payload)
    req.end()
  })
}

async function runApiInference(
  executionId: string,
  model: string,
  inputs: Record<string, unknown>,
  seed: number,
  signal: AbortSignal,
) {
  const db = getDb()
  const LOCAL_INFERENCE_PORT = 8765

  try {
    const inferRes = await inferencePost(LOCAL_INFERENCE_PORT, {
      prompt: inputs?.['api__prompt'] ?? '',
      negative_prompt: inputs?.['api__negative_prompt'] ?? '',
      width: inputs?.['api__width'] ?? 1024,
      height: inputs?.['api__height'] ?? 1024,
      num_inference_steps: inputs?.['api__num_inference_steps'] ?? 4,
      guidance_scale: inputs?.['api__guidance_scale'] ?? 0,
      seed,
    }, AbortSignal.any([signal, AbortSignal.timeout(1_800_000)]))

    if (!inferRes.ok) {
      await db.update(executions).set({ status: 'error', errorMessage: inferRes.body, completedAt: Date.now() })
        .where(eq(executions.id, executionId))
      return
    }

    const { image: imageB64 } = JSON.parse(inferRes.body) as { image: string }
    const imgBuffer = Buffer.from(imageB64, 'base64')
    const filename = 'output.png'
    const outDir = join(API_OUTPUTS_DIR, executionId)
    mkdirSync(outDir, { recursive: true })
    writeFileSync(join(outDir, filename), imgBuffer)

    const outputPath = `/api/executions/${executionId}/outputs/${filename}`
    const outputItems = [{ kind: 'image', filename, path: outputPath }]
    await db.update(executions).set({
      status: 'completed',
      outputsJson: JSON.stringify(outputItems),
      completedAt: Date.now(),
    }).where(eq(executions.id, executionId))
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    const isCancel = msg === 'AbortError' || (err instanceof Error && err.name === 'AbortError')
    await db.update(executions).set({
      status: 'error',
      errorMessage: isCancel ? 'Cancelled' : msg,
      completedAt: Date.now(),
    }).where(eq(executions.id, executionId))
  } finally {
    inFlightControllers.delete(executionId)
  }
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id } = await params

  const rows = await db
    .select({ execution: executions, username: users.username })
    .from(executions)
    .leftJoin(users, eq(executions.userId, users.id))
    .where(eq(executions.toolId, id))
    .orderBy(desc(executions.createdAt))
    .limit(100)

  return NextResponse.json(rows.map(({ execution, username }) => ({ ...execution, createdBy: username ?? null })))
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id: toolId } = await params

  const [tool] = await db.select().from(tools).where(eq(tools.id, toolId))
  if (!tool) return NextResponse.json({ error: 'Tool not found' }, { status: 404 })

  const body = await req.json()
  const { inputs, comfyOrgApiKey: comfyOrgApiKeyFromBody } = body
  const comfyOrgApiKey = comfyOrgApiKeyFromBody || getComfyOrgApiKeyServer()

  // ── API-engine tools (non-ComfyUI) ──────────────────────────────────────────
  if (tool.engine === 'api') {
    const currentUser = getRequestUser(req)
    const seed = inputs?.['api__seed'] ?? Math.floor(Math.random() * 2 ** 32)
    const executionId = uuidv4()
    const now = Date.now()

    await db.insert(executions).values({
      id: executionId,
      toolId,
      userId: currentUser?.id ?? null,
      inputsJson: JSON.stringify({ ...inputs, seed }),
      workflowHash: tool.workflowHash,
      seed,
      status: 'running',
      createdAt: now,
    })

    const config = JSON.parse(tool.workflowJson) as { engine: string; model: string }

    if (config.model === 'Tongyi-MAI/Z-Image-Turbo') {
      const LOCAL_INFERENCE_PORT = 8765

      try {
        // Check the server is up first (fast timeout)
        await fetch(`http://127.0.0.1:${LOCAL_INFERENCE_PORT}/health`, { signal: AbortSignal.timeout(2000) })
      } catch {
        const msg = `Z-Image Turbo inference server is not running. Use the Install & Start button to launch it.`
        await db.update(executions).set({ status: 'error', errorMessage: msg, completedAt: Date.now() }).where(eq(executions.id, executionId))
        return NextResponse.json({ error: msg }, { status: 503 })
      }

      // Fire inference in background — return immediately so the HTTP connection doesn't time out
      const controller = new AbortController()
      inFlightControllers.set(executionId, controller)
      runApiInference(executionId, config.model, inputs, seed, controller.signal)

      return NextResponse.json({ executionId, type: 'api', status: 'running', seed }, { status: 202 })
    }

    await db.update(executions).set({ status: 'error', errorMessage: 'Unknown API model', completedAt: Date.now() }).where(eq(executions.id, executionId))
    return NextResponse.json({ error: 'Unknown API model' }, { status: 400 })
  }

  // ── ComfyUI-engine tools ─────────────────────────────────────────────────────
  if (!tool.comfyPort) return NextResponse.json({ error: 'No ComfyUI port configured for this tool' }, { status: 400 })

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

  const currentUser = getRequestUser(req)

  // Insert execution row
  await db.insert(executions).values({
    id: executionId,
    toolId,
    userId: currentUser?.id ?? null,
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

  // ── Synchronous wait mode (?wait=true) ──────────────────────────────────────
  // Poll ComfyUI history server-side until the prompt completes, then save
  // outputs to disk and return the finished execution. Used by the HTTP SDK so
  // external apps don't need a browser watching a WebSocket.
  const waitMode = req.nextUrl.searchParams.get('wait') === 'true'
  if (waitMode) {
    const baseUrl = `http://localhost:${tool.comfyPort}`
    const maxWait = 300_000
    const started = Date.now()

    while (Date.now() - started < maxWait) {
      await new Promise((r) => setTimeout(r, 2000))
      let history: Record<string, unknown>
      try { history = await getHistory(promptId, baseUrl) } catch { continue }

      const entry = history[promptId] as {
        status?: { completed?: boolean; status_str?: string }
        outputs?: Record<string, { images?: { filename: string; subfolder: string }[] }>
      } | undefined

      if (!entry?.status?.completed) continue

      const rawOutputs: OutputItem[] = []
      for (const nodeOut of Object.values(entry.outputs ?? {})) {
        for (const img of nodeOut.images ?? []) {
          rawOutputs.push({ kind: 'image', filename: img.filename, subfolder: img.subfolder ?? '' })
        }
      }

      const isError = entry.status?.status_str === 'error'
      if (isError) {
        await db.update(executions)
          .set({ status: 'error', errorMessage: 'ComfyUI reported an error', completedAt: Date.now() })
          .where(eq(executions.id, executionId))
        return NextResponse.json({ error: 'ComfyUI reported an error' }, { status: 500 })
      }

      const savedOutputs = await saveComfyOutputsToDisk(rawOutputs, tool.comfyPort, toolId, executionId)
      await db.update(executions)
        .set({ status: 'completed', outputsJson: JSON.stringify(savedOutputs), completedAt: Date.now() })
        .where(eq(executions.id, executionId))

      const [row] = await db.select().from(executions).where(eq(executions.id, executionId))
      return NextResponse.json(row)
    }

    await db.update(executions)
      .set({ status: 'error', errorMessage: 'Execution timed out', completedAt: Date.now() })
      .where(eq(executions.id, executionId))
    return NextResponse.json({ error: 'Execution timed out' }, { status: 504 })
  }

  return NextResponse.json({
    executionId,
    promptId,
    clientId,
    comfyPort: tool.comfyPort,
    seed,
  }, { status: 202 })
}
