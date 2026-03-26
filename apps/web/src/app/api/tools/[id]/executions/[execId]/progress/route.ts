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
    const encoder = new TextEncoder()
    let lastLogCount = 0  // track which logs we've already sent
    const stream = new ReadableStream({
      async start(controller) {
        while (true) {
          const [latest] = await db.select().from(executions).where(eq(executions.id, execId))
          if (!latest) { controller.close(); return }

          const prog = latest.progressJson ? JSON.parse(latest.progressJson) as Record<string, unknown> : null

          // Emit any new log lines from the container
          const logs = (prog?.logs as string[] | undefined) ?? []
          if (logs.length > lastLogCount) {
            for (let i = lastLogCount; i < logs.length; i++) {
              controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message: logs[i] })}\n\n`))
            }
            lastLogCount = logs.length
          }

          if (prog && typeof prog.step === 'number') {
            const msg = (prog.message as string) ?? ''
            const lossMatch = msg.match(/loss:\s*([\d.e+-]+)/i)
            const lrMatch = msg.match(/lr:\s*([\d.e+-]+)/i)
            const speedMatch = msg.match(/([\d.]+)s\/it/i)
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({
              type: 'step',
              step: prog.step,
              total: prog.totalSteps ?? 0,
              loss: lossMatch ? parseFloat(lossMatch[1]) : null,
              speed: speedMatch ? 1 / parseFloat(speedMatch[1]) : null,
              lr: lrMatch ? parseFloat(lrMatch[1]) : null,
            })}\n\n`))
          } else if (prog?.message) {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'log', message: prog.message as string })}\n\n`))
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

          await new Promise(r => setTimeout(r, 3000))
        }
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
