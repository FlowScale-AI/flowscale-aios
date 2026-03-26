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
import { getComfyOrgApiKey as getComfyOrgApiKeyServer, getComfyInstances } from '@/lib/providerSettings'
import { getPlugin, type ToolPluginManifest } from '@/lib/toolPlugins'
import { autoRouteComfyPort, trackExecStart, trackExecEnd } from '@/lib/comfyAutoRoute'
import { getModalDeployUrl, autoRouteModalDeployment } from '@/lib/modal-deploy'
import { runTraining } from '@/lib/trainingExecution'
import { syncDatasetToModal, runModalTraining, downloadTrainingOutput, downloadSampleImage, buildTrainingPayload, type TrainingPayload, type TrainingHandle } from '@/lib/modalTraining'
import { isModalComfyPort, resolveComfyBaseUrl, getModalComfyByPort } from '@/lib/modal-comfyui'

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
        const comfyBaseUrl = resolveComfyBaseUrl(comfyPort)
        const url = `${comfyBaseUrl}/view?filename=${encodeURIComponent(item.filename)}&subfolder=${encodeURIComponent(subfolder)}&type=output`
        // Retry up to 3 times for Modal (container may need a moment after prompt completion)
        let res: Response | null = null
        for (let attempt = 0; attempt < 3; attempt++) {
          res = await fetch(url)
          if (res.ok) break
          if (attempt < 2) await new Promise(r => setTimeout(r, 1000))
        }
        if (!res || !res.ok) {
          console.error(`Failed to download output from ${url}: HTTP ${res?.status}`)
          return item
        }
        const buffer = Buffer.from(await res.arrayBuffer())
        const destName = `${executionId.slice(0, 8)}_${item.filename}`
        await writeFile(join(toolDir, destName), buffer)
        return { ...item, path: `/api/outputs/${toolId}/${destName}` }
      } catch (err) {
        console.error(`Error downloading output ${item.filename}:`, err)
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
  endpoint: string = '/generate',
): Promise<{ ok: boolean; status: number; body: string }> {
  const http = require('http') as typeof import('http')
  const payload = JSON.stringify(body)

  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: '127.0.0.1',
        port,
        path: endpoint,
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

/** Save outputs to disk and update execution record. */
async function finalizeExecution(
  executionId: string,
  outputs: Array<{ kind: string; filename: string; data: string }>,
) {
  const db = getDb()
  const outDir = join(API_OUTPUTS_DIR, executionId)
  mkdirSync(outDir, { recursive: true })

  const outputItems = outputs.map(({ kind, filename, data }) => {
    const buffer = Buffer.from(data, 'base64')
    writeFileSync(join(outDir, filename), buffer)
    return { kind, filename, path: `/api/executions/${executionId}/outputs/${filename}` }
  })

  await db.update(executions).set({
    status: 'completed',
    outputsJson: JSON.stringify(outputItems),
    completedAt: Date.now(),
  }).where(eq(executions.id, executionId))
}

/** Run inference on a local plugin server (e.g. Z-Image Turbo). */
async function runLocalInference(
  executionId: string,
  plugin: ToolPluginManifest,
  inputs: Record<string, unknown>,
  seed: number,
  signal: AbortSignal,
  device?: string,
) {
  const server = plugin.server as { port: number; generateEndpoint: string }

  try {
    const db = getDb()
    const body: Record<string, unknown> = { seed, ...(device ? { device } : {}) }
    for (const input of plugin.schema.inputs) {
      const value = inputs?.[`api__${input.paramName}`]
      body[input.paramName] = value !== undefined && value !== '' ? value : input.defaultValue
    }

    const inferRes = await inferencePost(server.port, body,
      AbortSignal.any([signal, AbortSignal.timeout(1_800_000)]),
      server.generateEndpoint)

    if (!inferRes.ok) {
      await db.update(executions).set({ status: 'error', errorMessage: inferRes.body, completedAt: Date.now() })
        .where(eq(executions.id, executionId))
      return
    }

    const responseData = JSON.parse(inferRes.body) as Record<string, string>
    const outputDef = plugin.schema.outputs[0]
    const outputField = outputDef?.paramName ?? 'image'
    const outputType = outputDef?.paramType ?? 'image'

    // Determine output kind and filename based on the output type
    let kind: string
    let filename: string
    if (outputType === 'video') {
      kind = 'video'
      filename = 'output.mp4'
    } else if (outputType === 'file') {
      kind = 'file'
      // Use server-provided filename if available (e.g. lora_file_filename)
      filename = responseData[`${outputField}_filename`] || 'output.bin'
    } else {
      kind = 'image'
      filename = 'output.png'
    }

    await finalizeExecution(executionId, [{
      kind,
      filename,
      data: responseData[outputField],
    }])
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    const isCancel = msg === 'AbortError' || (err instanceof Error && err.name === 'AbortError')
    try {
      await getDb().update(executions).set({
        status: 'error',
        errorMessage: isCancel ? 'Cancelled' : msg,
        completedAt: Date.now(),
      }).where(eq(executions.id, executionId))
    } catch (dbErr) {
      console.error(`Failed to mark execution ${executionId} as error:`, dbErr)
    }
  } finally {
    inFlightControllers.delete(executionId)
  }
}


/** Run inference on a Modal cloud deployment. */
async function runModalInference(
  executionId: string,
  plugin: ToolPluginManifest,
  inputs: Record<string, unknown>,
  seed: number,
  signal: AbortSignal,
  modalUrl: string,
) {
  try {
    const db = getDb()
    const body: Record<string, unknown> = { seed }
    for (const input of plugin.schema.inputs) {
      const value = inputs?.[`api__${input.paramName}`]
      body[input.paramName] = value !== undefined && value !== '' ? value : input.defaultValue
    }

    const res = await fetch(`${modalUrl.replace(/\/$/, '')}/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.any([signal, AbortSignal.timeout(600_000)]),
    })

    if (!res.ok) {
      const errText = await res.text().catch(() => `HTTP ${res.status}`)
      await db.update(executions).set({ status: 'error', errorMessage: errText, completedAt: Date.now() })
        .where(eq(executions.id, executionId))
      return
    }

    const responseData = await res.json() as Record<string, string>
    const outputDef = plugin.schema.outputs[0]
    const outputField = outputDef?.paramName ?? 'image'
    const outputType = outputDef?.paramType ?? 'image'

    let kind: string
    let filename: string
    if (outputType === 'video') {
      kind = 'video'
      filename = 'output.mp4'
    } else if (outputType === 'file') {
      kind = 'file'
      filename = responseData[`${outputField}_filename`] || 'output.bin'
    } else {
      kind = 'image'
      filename = 'output.png'
    }

    await finalizeExecution(executionId, [{
      kind,
      filename,
      data: responseData[outputField],
    }])
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Unknown error'
    const isCancel = msg === 'AbortError' || (err instanceof Error && err.name === 'AbortError')
    const isTimeout = msg.includes('TimeoutError') || msg.includes('timed out')
    try {
      await getDb().update(executions).set({
        status: 'error',
        errorMessage: isCancel ? 'Cancelled' : isTimeout ? 'Modal execution timed out (10 min)' : msg,
        completedAt: Date.now(),
      }).where(eq(executions.id, executionId))
    } catch (dbErr) {
      console.error(`Failed to mark execution ${executionId} as error:`, dbErr)
    }
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
  const { inputs, comfyOrgApiKey: comfyOrgApiKeyFromBody, comfyPort: comfyPortOverride, device: deviceOverride, provider: providerOverride, modalDeployId, gpu: gpuTier } = body
  const comfyOrgApiKey = comfyOrgApiKeyFromBody || getComfyOrgApiKeyServer()

  // ── API-engine tools (non-ComfyUI, plugin-driven) ───────────────────────────
  if (tool.engine === 'api') {
    const config = JSON.parse(tool.workflowJson) as { engine: string; model: string; pluginId: string }
    const plugin = getPlugin(config.pluginId)

    // ── Training execution branch ───────────────────────────────────────────
    if (plugin?.server.type === 'training') {
      const provider = providerOverride as string | undefined
      const isModalTraining = provider === 'modal' || comfyPortOverride === 'modal'

      if (isModalTraining) {
        // ── Modal cloud training (ephemeral `modal run`) ─────────────────────────────────────
        const currentUser = getRequestUser(req)
        const executionId = uuidv4()

        let payload: TrainingPayload
        try {
          payload = buildTrainingPayload(inputs ?? {})
          const highVramGpus = ['H100', 'H200', 'B200', 'A100-80GB']
          if (gpuTier && highVramGpus.includes(gpuTier as string)) {
            payload.quantize = false
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : 'Invalid training inputs'
          return NextResponse.json({ error: msg }, { status: 400 })
        }

        await db.insert(executions).values({
          id: executionId,
          toolId,
          userId: currentUser?.id ?? null,
          inputsJson: JSON.stringify(payload),
          outputsJson: null,
          seed: 0,
          promptId: null,
          workflowHash: tool.workflowHash,
          status: 'running',
          comfyPort: null,
          createdAt: Date.now(),
        })
        db.update(tools).set({ lastUsedAt: Date.now() }).where(eq(tools.id, toolId)).run()

        const resolvedGpu = (gpuTier as string) || 'A100-40GB'

        // Fire and forget — sync, train (blocking with progress), download
        ;(async () => {
          try {
            await db.update(executions).set({ progressJson: JSON.stringify({ message: 'Syncing dataset to cloud...' }) })
              .where(eq(executions.id, executionId))
            await syncDatasetToModal(payload.datasetId, (msg) => {
              db.update(executions).set({ progressJson: JSON.stringify({ message: msg }) })
                .where(eq(executions.id, executionId)).run()
            })

            await db.update(executions).set({ progressJson: JSON.stringify({ message: 'Starting training on Modal...' }) })
              .where(eq(executions.id, executionId))

            const recentLogs: string[] = []
            const handle = runModalTraining(
              { ...payload, jobId: executionId },
              resolvedGpu,
              (progress) => {
                db.update(executions).set({ progressJson: JSON.stringify({ ...progress, logs: recentLogs.slice(-50) }) })
                  .where(eq(executions.id, executionId)).run()
              },
              (line) => {
                recentLogs.push(line)
                if (recentLogs.length > 100) recentLogs.shift()
              },
            )

            // Store handle for cancellation support
            inFlightControllers.set(executionId, { abort: () => handle.cancel() } as unknown as AbortController)

            const result = await handle.result

            if (result.success && result.outputVolumePath) {
              await db.update(executions).set({ progressJson: JSON.stringify({ message: 'Downloading trained LoRA...' }) })
                .where(eq(executions.id, executionId))

              const output = await downloadTrainingOutput(
                result.outputVolumePath, payload.outputName, toolId, executionId,
              )

              // Download sample image if available
              let sampleApiPath: string | null = null
              if (result.sampleVolumePath) {
                sampleApiPath = await downloadSampleImage(result.sampleVolumePath, toolId, executionId)
              }

              const outputItems: Array<Record<string, unknown>> = [{
                kind: 'file',
                filename: `${executionId.slice(0, 8)}_${payload.outputName}.safetensors`,
                path: output.apiPath,
                lorasCopyPath: output.lorasCopyPath,
              }]
              if (sampleApiPath) {
                outputItems.push({ kind: 'image', filename: `${executionId.slice(0, 8)}_sample.jpg`, path: sampleApiPath })
              }

              await db.update(executions).set({
                status: 'completed',
                outputsJson: JSON.stringify(outputItems),
                completedAt: Date.now(),
              }).where(eq(executions.id, executionId))
            } else {
              await db.update(executions).set({
                status: 'error',
                errorMessage: result.error || 'Training failed',
                completedAt: Date.now(),
              }).where(eq(executions.id, executionId))
            }
          } catch (err) {
            console.error(`Modal training failed for ${executionId}:`, err)
            await db.update(executions).set({
              status: 'error',
              errorMessage: err instanceof Error ? err.message : 'Modal training failed',
              completedAt: Date.now(),
            }).where(eq(executions.id, executionId))
          } finally {
            inFlightControllers.delete(executionId)
          }
        })()

        return NextResponse.json({ id: executionId, executionId, type: 'modal-training' }, { status: 202 })
      }

      // ── Local training branch (existing code) ─────────────────────────────
      const currentUser = getRequestUser(req)
      const executionId = uuidv4()

      const trainingConfig = {
        ...inputs,
        device: deviceOverride,
      }

      await db.insert(executions).values({
        id: executionId,
        toolId,
        userId: currentUser?.id ?? null,
        inputsJson: JSON.stringify(trainingConfig),
        outputsJson: null,
        seed: 0,
        promptId: null,
        workflowHash: tool.workflowHash,
        status: 'running',
        comfyPort: null,
        createdAt: Date.now(),
      })

      try {
        const { jobId } = await runTraining(executionId, config.pluginId, trainingConfig)
        await db.update(executions).set({
          metadataJson: JSON.stringify({ jobId, pluginId: config.pluginId }),
        }).where(eq(executions.id, executionId))

        return NextResponse.json({ executionId, jobId }, { status: 202 })
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Failed to start training'
        await db.update(executions).set({
          status: 'error',
          errorMessage: msg,
          completedAt: Date.now(),
        }).where(eq(executions.id, executionId))
        return NextResponse.json({ error: msg }, { status: 500 })
      }
    }

    // ── Modal cloud execution ───────────────────────────────────────────────
    // Support both old format (comfyPort: 'modal') and new (provider: 'modal', modalDeployId: '...')
    const provider = providerOverride as string | undefined
    const isModal = provider === 'modal' || comfyPortOverride === 'modal'

    if (isModal) {
      if (!plugin) {
        return NextResponse.json({ error: `Unknown API plugin: ${config.pluginId}` }, { status: 400 })
      }

      let modalUrl: string | null = null
      const resolvedDeployId = (modalDeployId as string | undefined) ?? 'auto'

      if (resolvedDeployId === 'auto') {
        const deployment = autoRouteModalDeployment(config.pluginId)
        if (!deployment) {
          return NextResponse.json({ error: 'No Modal deployments available. Deploy from the tool page first.' }, { status: 400 })
        }
        modalUrl = deployment.url
      } else {
        modalUrl = getModalDeployUrl(config.pluginId, resolvedDeployId)
        if (!modalUrl) {
          return NextResponse.json({ error: `Modal deployment "${resolvedDeployId}" not found or not ready.` }, { status: 400 })
        }
      }

      const currentUser = getRequestUser(req)
      const seed = inputs?.['api__seed'] ?? Math.floor(Math.random() * 2 ** 32)
      const executionId = uuidv4()

      await db.insert(executions).values({
        id: executionId,
        toolId,
        userId: currentUser?.id ?? null,
        inputsJson: JSON.stringify({ ...inputs, seed }),
        workflowHash: tool.workflowHash,
        seed,
        status: 'running',
        createdAt: Date.now(),
      })
      db.update(tools).set({ lastUsedAt: Date.now() }).where(eq(tools.id, toolId)).run()

      const controller = new AbortController()
      inFlightControllers.set(executionId, controller)

      runModalInference(executionId, plugin, inputs, seed, controller.signal, modalUrl)
        .catch(async (err) => {
          console.error(`Unhandled error in runModalInference for ${executionId}:`, err)
          try {
            await db.update(executions).set({
              status: 'error', errorMessage: err instanceof Error ? err.message : 'Unknown error', completedAt: Date.now(),
            }).where(eq(executions.id, executionId))
          } catch { /* already logged */ }
          inFlightControllers.delete(executionId)
        })

      return NextResponse.json({ executionId, type: 'modal', status: 'running', seed }, { status: 202 })
    }

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
    db.update(tools).set({ lastUsedAt: Date.now() }).where(eq(tools.id, toolId)).run()

    if (!plugin) {
      await db.update(executions).set({ status: 'error', errorMessage: `Unknown API plugin: ${config.pluginId}`, completedAt: Date.now() }).where(eq(executions.id, executionId))
      return NextResponse.json({ error: `Unknown API plugin: ${config.pluginId}` }, { status: 400 })
    }

    const controller = new AbortController()
    inFlightControllers.set(executionId, controller)

    const { port, healthEndpoint } = plugin.server
    try {
      await fetch(`http://127.0.0.1:${port}${healthEndpoint}`, { signal: AbortSignal.timeout(2000) })
    } catch {
      const msg = `${plugin.name} inference server is not running. Use the Install & Start button to launch it.`
      await db.update(executions).set({ status: 'error', errorMessage: msg, completedAt: Date.now() }).where(eq(executions.id, executionId))
      inFlightControllers.delete(executionId)
      return NextResponse.json({ error: msg }, { status: 503 })
    }
    runLocalInference(executionId, plugin, inputs, seed, controller.signal, deviceOverride)
      .catch(async (err) => {
        console.error(`Unhandled error in runLocalInference for ${executionId}:`, err)
        try {
          await db.update(executions).set({
            status: 'error',
            errorMessage: err instanceof Error ? err.message : 'Unknown error',
            completedAt: Date.now(),
          }).where(eq(executions.id, executionId))
        } catch { /* DB update failed — already logged above */ }
        inFlightControllers.delete(executionId)
      })

    return NextResponse.json({ executionId, type: 'api', status: 'running', seed }, { status: 202 })
  }

  // ── ComfyUI-engine tools ─────────────────────────────────────────────────────
  // Validate comfyPort override against configured instances to prevent arbitrary port access
  if (comfyPortOverride != null) {
    const validPorts = new Set(getComfyInstances().map((i) => i.port))
    const isValidModalComfyPort = isModalComfyPort(comfyPortOverride) && getModalComfyByPort(comfyPortOverride) != null
    if (!validPorts.has(comfyPortOverride) && !isValidModalComfyPort) {
      return NextResponse.json({ error: 'Invalid ComfyUI port — not a configured instance' }, { status: 400 })
    }
  }
  // Server-side auto-routing: when no port override is provided, pick the
  // least-busy running instance. Falls back to the tool's stored port.
  const comfyPort = comfyPortOverride ?? await autoRouteComfyPort(tool.comfyPort)
  if (!comfyPort) return NextResponse.json({ error: 'No ComfyUI port configured for this tool' }, { status: 400 })

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
    const infoRes = await fetch(`${resolveComfyBaseUrl(comfyPort)}/object_info`, {
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
    comfyPort,
    createdAt: now,
  })
  db.update(tools).set({ lastUsedAt: Date.now() }).where(eq(tools.id, toolId)).run()
  trackExecStart(comfyPort, executionId)

  // Queue the prompt via embedded ComfyUI proxy (non-blocking)
  const promptPayload: Record<string, unknown> = { prompt: workflow, client_id: clientId }
  if (comfyOrgApiKey) {
    promptPayload.extra_data = { api_key_comfy_org: comfyOrgApiKey }
  }
  let queueRes: Response
  try {
    queueRes = await fetch(`${resolveComfyBaseUrl(comfyPort)}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(promptPayload),
    })
  } catch {
    const errorMessage = `ComfyUI is not reachable on port ${comfyPort}. Make sure it is running.`
    trackExecEnd(comfyPort)
    await db.update(executions).set({ status: 'error', errorMessage, completedAt: Date.now() })
      .where(eq(executions.id, executionId))
    return NextResponse.json({ error: errorMessage }, { status: 503 })
  }

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

    trackExecEnd(comfyPort)
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
  // For Modal ComfyUI, start a background poller that downloads outputs
  // as soon as the prompt completes (before the container scales down).
  if (isModalComfyPort(comfyPort)) {
    const modalBaseUrl = resolveComfyBaseUrl(comfyPort)
    ;(async () => {
      const maxWait = 300_000
      const started = Date.now()
      while (Date.now() - started < maxWait) {
        await new Promise((r) => setTimeout(r, 2000))
        let history: Record<string, unknown>
        try { history = await getHistory(promptId, modalBaseUrl) } catch { continue }
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

        if (entry.status?.status_str === 'error') {
          trackExecEnd(comfyPort)
          await db.update(executions).set({ status: 'error', errorMessage: 'ComfyUI reported an error', completedAt: Date.now() })
            .where(eq(executions.id, executionId))
          return
        }

        const savedOutputs = await saveComfyOutputsToDisk(rawOutputs, comfyPort, toolId, executionId)
        trackExecEnd(comfyPort)
        await db.update(executions).set({ status: 'completed', outputsJson: JSON.stringify(savedOutputs), completedAt: Date.now() })
          .where(eq(executions.id, executionId))
        return
      }
      // Timeout
      trackExecEnd(comfyPort)
      await db.update(executions).set({ status: 'error', errorMessage: 'Modal execution timed out', completedAt: Date.now() })
        .where(eq(executions.id, executionId))
    })().catch(console.error)
  }

  const waitMode = req.nextUrl.searchParams.get('wait') === 'true'
  if (waitMode) {
    const baseUrl = resolveComfyBaseUrl(comfyPort)
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
        trackExecEnd(comfyPort)
        await db.update(executions)
          .set({ status: 'error', errorMessage: 'ComfyUI reported an error', completedAt: Date.now() })
          .where(eq(executions.id, executionId))
        return NextResponse.json({ error: 'ComfyUI reported an error' }, { status: 500 })
      }

      const savedOutputs = await saveComfyOutputsToDisk(rawOutputs, comfyPort, toolId, executionId)
      trackExecEnd(comfyPort)
      await db.update(executions)
        .set({ status: 'completed', outputsJson: JSON.stringify(savedOutputs), completedAt: Date.now() })
        .where(eq(executions.id, executionId))

      const [row] = await db.select().from(executions).where(eq(executions.id, executionId))
      return NextResponse.json(row)
    }

    trackExecEnd(comfyPort)
    await db.update(executions)
      .set({ status: 'error', errorMessage: 'Execution timed out', completedAt: Date.now() })
      .where(eq(executions.id, executionId))
    return NextResponse.json({ error: 'Execution timed out' }, { status: 504 })
  }

  return NextResponse.json({
    executionId,
    promptId,
    clientId,
    comfyPort,
    seed,
  }, { status: 202 })
}
