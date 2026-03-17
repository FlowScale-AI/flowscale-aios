/**
 * Server-side ComfyUI instance auto-routing.
 *
 * When multiple ComfyUI instances are running, this module picks the
 * least-busy one based on in-memory execution tracking. The routing is
 * shared across all users and all API surfaces (tool executions, bridge
 * tool runs, SDK calls) — unlike the old client-side round-robin which
 * was per-browser-tab.
 *
 * Running-instance discovery is cached with a short TTL so we don't
 * probe ports on every single execution request.
 */

import { getComfyInstances } from './providerSettings'
import { probePort } from './comfy-probe'

// ── In-memory execution tracking ─────────────────────────────────────────────

const activeExecCount = new Map<number, number>()
/** Maps executionId → comfyPort so we can decrement the right counter on completion. */
const execPortMap = new Map<string, number>()

/** Call when an execution starts on a given port. */
export function trackExecStart(port: number, executionId?: string): void {
  activeExecCount.set(port, (activeExecCount.get(port) ?? 0) + 1)
  if (executionId) execPortMap.set(executionId, port)
}

/** Call when an execution finishes (completed, error, or cancelled) on a given port. */
export function trackExecEnd(port: number): void {
  const count = activeExecCount.get(port) ?? 1
  activeExecCount.set(port, Math.max(0, count - 1))
}

/**
 * End tracking for an execution by its ID.
 * Looks up the port from the internal map so callers don't need to know it.
 */
export function trackExecEndById(executionId: string): void {
  const port = execPortMap.get(executionId)
  if (port != null) {
    trackExecEnd(port)
    execPortMap.delete(executionId)
  }
}

/** Get the current active execution count for each port. */
export function getActiveExecCounts(): Record<number, number> {
  const result: Record<number, number> = {}
  for (const [port, count] of activeExecCount) {
    result[port] = count
  }
  return result
}

// ── Running-instance cache ───────────────────────────────────────────────────

let cachedRunningPorts: number[] = []
let cacheTime = 0
const CACHE_TTL = 10_000 // 10 seconds

async function getRunningPorts(): Promise<number[]> {
  if (Date.now() - cacheTime < CACHE_TTL && cachedRunningPorts.length > 0) {
    return cachedRunningPorts
  }

  const instances = getComfyInstances()
  const results = await Promise.all(
    instances.map(async (i) => ({ port: i.port, alive: !!(await probePort(i.port)) })),
  )

  cachedRunningPorts = results.filter((r) => r.alive).map((r) => r.port)
  cacheTime = Date.now()
  return cachedRunningPorts
}

/** Invalidate the running-ports cache (e.g. after start/stop). */
export function invalidatePortCache(): void {
  cacheTime = 0
}

// ── Auto-route ───────────────────────────────────────────────────────────────

/**
 * Resolve the best ComfyUI port for a new execution.
 *
 * Strategy: **least-busy** — picks the running instance with the fewest
 * currently active executions. Falls back to the tool's configured port
 * if provided, or null if nothing is running.
 *
 * @param fallbackPort  Optional port to return if no running instances found
 *                      (e.g. the tool's stored comfyPort).
 */
export async function autoRouteComfyPort(fallbackPort?: number | null): Promise<number | null> {
  const ports = await getRunningPorts()

  if (ports.length === 0) return fallbackPort ?? null
  if (ports.length === 1) return ports[0]

  // Least-busy: pick the port with the fewest active executions
  let best = ports[0]
  let bestCount = activeExecCount.get(ports[0]) ?? 0

  for (let i = 1; i < ports.length; i++) {
    const count = activeExecCount.get(ports[i]) ?? 0
    if (count < bestCount) {
      best = ports[i]
      bestCount = count
    }
  }

  return best
}
