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

  const metadata = exec.metadataJson ? JSON.parse(exec.metadataJson) as { jobId: string; pluginId: string } : null
  if (!metadata) {
    return new Response('No training job metadata', { status: 400 })
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
