import { NextRequest } from 'next/server'
import { getDb } from '@/lib/db'
import { executions } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getPlugin } from '@/lib/toolPlugins'
import { finalizeTrainingExecution } from '@/lib/trainingExecution'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; execId: string }> },
) {
  const { id: toolId, execId } = await params
  const db = getDb()

  const [exec] = await db.select().from(executions).where(eq(executions.id, execId))
  if (!exec || exec.toolId !== toolId) {
    return new Response('Not found', { status: 404 })
  }

  const metadata = exec.metadataJson ? JSON.parse(exec.metadataJson) as { jobId: string; pluginId: string; modalUrl?: string } : null

  // Ephemeral modal training (no metadataJson) — progress is written directly to progress_json by the route handler
  if (!metadata) {
    const progress = exec.progressJson ? JSON.parse(exec.progressJson) as Record<string, unknown> : null

    // Convert progress_json format to SSE events for the TrainingProgress component
    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      async start(controller) {
        const poll = async () => {
          const [latest] = await db.select().from(executions).where(eq(executions.id, execId))
          if (!latest) { controller.close(); return }

          const prog = latest.progressJson ? JSON.parse(latest.progressJson) as Record<string, unknown> : null
          if (prog && typeof prog.step === 'number') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'step',
              step: prog.step,
              total: prog.totalSteps ?? 0,
              loss: null,
              speed: null,
              lr: null,
            })}\n\n`))
          } else if (prog?.message) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message: prog.message })}\n\n`))
          }

          if (latest.status === 'completed') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'complete' })}\n\n`))
            controller.close()
            return
          }
          if (latest.status === 'error') {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: latest.errorMessage ?? 'Training failed' })}\n\n`))
            controller.close()
            return
          }

          // Poll again in 3s
          await new Promise(r => setTimeout(r, 3000))
          await poll()
        }
        await poll()
      },
    })

    return new Response(stream, {
      headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive' },
    })
  }

  // Legacy: Modal training with modalUrl — proxy progress from Modal URL or return DB-cached progress
  if (metadata.modalUrl) {
    try {
      const progressRes = await fetch(`${metadata.modalUrl}/train/${metadata.jobId}/progress`, {
        signal: AbortSignal.timeout(10_000),
      })
      if (progressRes.ok) {
        const progress = await progressRes.json()
        return new Response(JSON.stringify(progress), {
          headers: { 'Content-Type': 'application/json' },
        })
      }
    } catch { /* fall through to DB */ }

    if (exec.progressJson) {
      return new Response(exec.progressJson, {
        headers: { 'Content-Type': 'application/json' },
      })
    }
    return new Response(JSON.stringify({ status: exec.status, message: 'Waiting for progress...' }), {
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const plugin = getPlugin(metadata.pluginId)
  if (!plugin) {
    return new Response('Plugin not found', { status: 404 })
  }

  const rawEndpoint = plugin.server.progressEndpoint ?? `/train/${metadata.jobId}/progress`
  const progressEndpoint = rawEndpoint.replace('{jobId}', metadata.jobId)
  const port = plugin.server.port

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()

      try {
        const res = await fetch(`http://127.0.0.1:${port}${progressEndpoint}`, {
          headers: { 'Accept': 'text/event-stream' },
        })

        if (!res.ok || !res.body) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Failed to connect to training server' })}\n\n`))
          controller.close()
          return
        }

        const reader = res.body.getReader()
        const decoder = new TextDecoder()

        while (true) {
          const { done, value } = await reader.read()
          if (done) break

          const text = decoder.decode(value, { stream: true })
          controller.enqueue(encoder.encode(text))

          for (const line of text.split('\n')) {
            if (!line.startsWith('data: ')) continue
            try {
              const event = JSON.parse(line.slice(6)) as { type: string; [key: string]: unknown }

              if (event.type === 'step') {
                await db.update(executions).set({
                  progressJson: JSON.stringify(event),
                }).where(eq(executions.id, execId))
              }

              if (event.type === 'complete') {
                const outputPath = event.outputPath as string
                const outputName = (event.outputName as string) || 'output'
                await finalizeTrainingExecution(execId, toolId, outputPath, outputName)
              }

              if (event.type === 'error') {
                await db.update(executions).set({
                  status: 'error',
                  errorMessage: event.message as string,
                  completedAt: Date.now(),
                }).where(eq(executions.id, execId))
              }
            } catch { /* not JSON, skip */ }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'SSE stream error'
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: msg })}\n\n`))
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
