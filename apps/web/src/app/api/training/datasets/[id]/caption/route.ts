import { NextRequest, NextResponse } from 'next/server'
import { getDataset, getDatasetDir } from '@/lib/training'
import { scanPlugins } from '@/lib/toolPlugins'
import { isServerRunning } from '@/lib/localInference'
import { join } from 'path'
import { writeFileSync } from 'fs'

export const dynamic = 'force-dynamic'

function findCaptioningPlugin(): { pluginId: string; port: number } | null {
  const plugins = scanPlugins().filter((p) => p.server.type === 'training')
  for (const p of plugins) {
    return { pluginId: p.id, port: p.server.port }
  }
  return null
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const dataset = getDataset(id)
  if (!dataset) return NextResponse.json({ error: 'Dataset not found' }, { status: 404 })

  const body = await req.json() as { mode?: 'detailed' | 'brief' }
  const mode = body.mode ?? 'detailed'

  const captioner = findCaptioningPlugin()
  if (!captioner) {
    return NextResponse.json({ error: 'No training plugin installed. Install a LoRA trainer first.' }, { status: 400 })
  }

  const running = await isServerRunning(captioner.pluginId)
  if (!running) {
    return NextResponse.json({ error: 'Training plugin server is not running. Start it first.' }, { status: 400 })
  }

  const dir = getDatasetDir(id)
  const images = dataset.images.map((img) => ({
    path: join(dir, img.name),
    mode,
  }))

  const stream = new ReadableStream({
    async start(controller) {
      const encoder = new TextEncoder()
      try {
        const res = await fetch(`http://127.0.0.1:${captioner.port}/caption/batch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ images }),
        })

        if (!res.ok || !res.body) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: 'error', message: 'Captioning request failed' })}\n\n`))
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
              const event = JSON.parse(line.slice(6)) as { type: string; imageName?: string; caption?: string }
              if (event.type === 'caption' && event.imageName && event.caption) {
                const baseName = event.imageName.substring(0, event.imageName.lastIndexOf('.'))
                writeFileSync(join(dir, `${baseName}.txt`), event.caption)
              }
            } catch { /* skip */ }
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : 'Captioning error'
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
