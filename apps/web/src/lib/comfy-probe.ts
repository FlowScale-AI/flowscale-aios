import { createConnection } from 'net'

/**
 * Ports where an externally-launched ComfyUI is commonly found. Probed by the
 * scan route for auto-discovery, allowlisted by the executions route, and
 * checked by the spawn guardrail to prevent device collisions.
 * Keep this as the single source of truth — add new well-known ports here.
 */
export const WELL_KNOWN_COMFY_PORTS = [8000, 8188, 8189, 8190] as const

export interface ComfyInstance {
  port: number
  systemStats: Record<string, unknown> | null
  instanceId?: string   // e.g. 'gpu-0', 'cpu'
  device?: string       // e.g. 'cuda:0', 'cpu'
  label?: string        // e.g. 'GPU 0 — RTX 4090'
}

export async function probePort(port: number): Promise<ComfyInstance | null> {
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
