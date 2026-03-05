import { NextRequest } from 'next/server'

type Params = { params: Promise<{ port: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const { port } = await params
  const clientId = crypto.randomUUID()
  const encoder = new TextEncoder()

  const stream = new ReadableStream({
    start(controller) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?clientId=${clientId}`)

      ws.onopen = () => {
        // Subscribe so ComfyUI streams terminal log entries to this socket
        fetch(`http://127.0.0.1:${port}/internal/logs/subscribe`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, enabled: true }),
        }).catch(() => {})
      }

      ws.onmessage = (event) => {
        if (typeof event.data === 'string') {
          controller.enqueue(encoder.encode(`data: ${event.data}\n\n`))
        }
      }

      ws.onerror = () => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: '_error' })}\n\n`),
          )
          controller.close()
        } catch {}
      }

      ws.onclose = () => {
        try {
          controller.enqueue(
            encoder.encode(`data: ${JSON.stringify({ type: '_closed' })}\n\n`),
          )
          controller.close()
        } catch {}
      }

      req.signal.addEventListener('abort', () => {
        ws.close()
        try { controller.close() } catch {}
      })
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
