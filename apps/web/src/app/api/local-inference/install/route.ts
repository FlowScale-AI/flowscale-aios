import { NextResponse } from 'next/server'
import { resolvePython, areDepsInstalled, spawnInstall, spawnServer, isServerRunning } from '@/lib/localInference'

export async function POST() {
  const encoder = new TextEncoder()

  function msg(data: Record<string, unknown>) {
    return encoder.encode(`data: ${JSON.stringify(data)}\n\n`)
  }

  const stream = new ReadableStream({
    async start(controller) {
      const send = (data: Record<string, unknown>) => {
        try { controller.enqueue(msg(data)) } catch { /* closed */ }
      }

      // 1. Resolve Python
      let python: string
      try {
        python = resolvePython()
        send({ log: `Using ${python}` })
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) })
        controller.close()
        return
      }

      // 2. pip install (skip if already installed)
      if (areDepsInstalled(python)) {
        send({ log: 'Dependencies already installed, skipping.' })
      } else {
        send({ log: 'Installing Python dependencies…' })
        await new Promise<void>((resolve, reject) => {
          const proc = spawnInstall(python)
          proc.stdout?.on('data', (chunk: Buffer) => send({ log: chunk.toString() }))
          proc.stderr?.on('data', (chunk: Buffer) => send({ log: chunk.toString() }))
          proc.on('close', (code) => {
            if (code === 0) resolve()
            else reject(new Error(`pip install exited with code ${code}`))
          })
          proc.on('error', reject)
        }).catch((err) => {
          send({ error: err instanceof Error ? err.message : String(err) })
          controller.close()
          throw err
        })
        send({ log: 'Dependencies installed.' })
      }

      // 3. Start server (non-blocking — client polls for readiness)
      if (await isServerRunning()) {
        send({ log: 'Server already running.', done: true })
        controller.close()
        return
      }

      send({ log: 'Starting inference server… (downloading model on first run — this may take several minutes)' })
      try {
        spawnServer(python)
        send({ log: 'Server process started. Waiting for model to load…', starting: true })
      } catch (err) {
        send({ error: err instanceof Error ? err.message : String(err) })
      }

      controller.close()
    },
  })

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    },
  })
}
