import { NextRequest } from 'next/server'
import WebSocket from 'ws'

type Params = { port: string }

export async function GET(req: NextRequest, { params }: { params: Promise<Params> }) {
  const { port } = await params
  const clientId = `server-logs-${Math.random().toString(36).slice(2)}`

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    start(controller) {
      const send = (data: string) => {
        try {
          controller.enqueue(encoder.encode(`data: ${data}\n\n`))
        } catch {}
      }

      const ws = new WebSocket(`ws://127.0.0.1:${port}/ws?clientId=${clientId}`)

      ws.on('open', () => {
        // Subscribe to logs for this clientId
        fetch(`http://127.0.0.1:${port}/internal/logs/subscribe`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, enabled: true }),
        }).catch(() => {})
      })

      ws.on('message', (data) => {
        try {
          const msg = JSON.parse(data.toString())
          if (msg.type === 'logs') {
            send(JSON.stringify(msg))
          }
        } catch {}
      })

      ws.on('close', () => {
        send(JSON.stringify({ type: '_closed' }))
        try { controller.close() } catch {}
      })

      ws.on('error', () => {
        send(JSON.stringify({ type: '_error' }))
        try { controller.close() } catch {}
      })

      // Clean up when the client disconnects
      req.signal.addEventListener('abort', () => {
        fetch(`http://127.0.0.1:${port}/internal/logs/subscribe`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ clientId, enabled: false }),
        }).catch(() => {})
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
