import { NextResponse } from 'next/server'
import { ComfyInstance } from '../../comfy/scan/route'
import { createConnection } from 'net'

async function probePort(port: number): Promise<ComfyInstance | null> {
  const isOpen = await new Promise<boolean>((resolve) => {
    const socket = createConnection({ port, host: '127.0.0.1' })
    socket.setTimeout(1500)
    socket.on('connect', () => { socket.destroy(); resolve(true) })
    socket.on('error', () => resolve(false))
    socket.on('timeout', () => { socket.destroy(); resolve(false) })
  })

  if (!isOpen) return null

  try {
    const res = await fetch(`http://127.0.0.1:${port}/system_stats`, {
      signal: AbortSignal.timeout(2000),
    })
    if (!res.ok) return null
    const stats = await res.json() as Record<string, unknown>
    return { port, systemStats: stats }
  } catch {
    return null
  }
}

export async function GET() {
  const ports = Array.from({ length: 101 }, (_, i) => 8188 + i)
  const results = await Promise.all(ports.map(probePort))
  const instances = results.filter((r): r is ComfyInstance => r !== null)

  return NextResponse.json({
    comfyInstances: instances,
    timestamp: Date.now(),
  })
}
