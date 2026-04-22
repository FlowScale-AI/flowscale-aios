import { NextRequest, NextResponse } from 'next/server'
import {
  getAllInstanceStatuses,
  getInstanceStatus,
  startInstance,
  stopInstance,
  restartInstance,
  startAll,
  stopAll,
} from '@/lib/comfyui-manager'
import { getComfyManagedPath, getComfyInstallType, getComfyInstanceById, getExtraComfyPorts } from '@/lib/providerSettings'
import { probePort, WELL_KNOWN_COMFY_PORTS, type ComfyDevice } from '@/lib/comfy-probe'
import { getListeningPortOwners, getProcessDescendants } from '@/lib/process-utils'
import { getRequestUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const managedPath = getComfyManagedPath()
  const installType = getComfyInstallType()
  const statuses = getAllInstanceStatuses()

  // Custom launch scripts can pick any port (e.g. a portable .bat hardcoded to
  // 8189 instead of our managed 41188). For instances using a script and whose
  // configured port doesn't respond, walk the spawned process tree, find a
  // descendant PID that's listening on a known ComfyUI port, and treat that as
  // the instance's actual port. This avoids the stuck-Starting + duplicate-
  // External symptom where one ComfyUI process is shown twice.
  const candidatePorts = new Set<number>([
    ...WELL_KNOWN_COMFY_PORTS,
    ...getExtraComfyPorts(),
  ])
  const aliveScriptPids = statuses
    .filter((st) => st.alive && st.pid && getComfyInstanceById(st.id)?.launchScriptId)
    .map((st) => st.pid!) as number[]

  // Only pay the netstat/ps cost when at least one custom-script instance is
  // alive — managed-launch instances don't need port reattribution.
  let portOwners = new Map<number, number>()
  const descendantsByRoot = new Map<number, Set<number>>()
  if (aliveScriptPids.length > 0) {
    portOwners = await getListeningPortOwners()
    const trees = await Promise.all(aliveScriptPids.map((p) => getProcessDescendants(p)))
    aliveScriptPids.forEach((p, i) => descendantsByRoot.set(p, trees[i]))
  }

  // For each instance, determine status:
  // - If PID is alive and HTTP responds → running
  // - If PID is alive but HTTP not ready on configured port → try reattribution
  //   (custom script may run on a different port); else starting
  // - If PID is dead, still probe the port (catches externally-started or legacy-PID instances)
  const instances = await Promise.all(
    statuses.map(async (st) => {
      const launchScriptId = getComfyInstanceById(st.id)?.launchScriptId
      let status: 'running' | 'starting' | 'stopped'
      let actualPort: number | undefined
      let devices: ComfyDevice[] | undefined

      const probeAndCapture = async (port: number) => {
        const probe = await probePort(port)
        if (probe) devices = probe.devices
        return !!probe
      }

      if (st.alive) {
        const httpReady = await probeAndCapture(st.port)
        if (httpReady) {
          status = 'running'
        } else if (launchScriptId && st.pid) {
          // Look for a port owned by the spawned process tree that has ComfyUI
          const tree = descendantsByRoot.get(st.pid)
          let foundPort: number | undefined
          if (tree) {
            for (const port of candidatePorts) {
              if (port === st.port) continue
              const owner = portOwners.get(port)
              if (owner && tree.has(owner)) {
                if (await probeAndCapture(port)) {
                  foundPort = port
                  break
                }
              }
            }
          }
          if (foundPort != null) {
            actualPort = foundPort
            status = 'running'
          } else {
            status = 'starting'
          }
        } else {
          status = 'starting'
        }
      } else {
        // No tracked PID — probe the AIOS-configured port to recover from
        // PID file loss (e.g. hot-reload). If something responds on our port,
        // it's an AIOS-spawned instance whose PID file was cleaned up.
        const httpReady = await probeAndCapture(st.port)
        status = httpReady ? 'running' : 'stopped'
      }
      // Report the runtime port so downstream code (compute pickers, execution
      // routing, dedupe-by-port) doesn't need to know about the reattribution.
      // Settings-only UI uses `configuredPort` to surface the mismatch.
      const effectivePort = actualPort ?? st.port
      return {
        id: st.id,
        status,
        pid: st.pid ?? undefined,
        port: effectivePort,
        configuredPort: actualPort != null ? st.port : undefined,
        device: st.device,
        label: st.label,
        launchScriptId,
        devices,
      }
    }),
  )

  return NextResponse.json({
    instances,
    managedPath: managedPath ?? null,
    installType: installType ?? null,
    isSetup: !!managedPath,
  })
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { action, instanceId } = (await req.json()) as {
    action: string
    instanceId?: string
  }

  // Validate action against allowed values
  const validActions = new Set(['start', 'stop', 'restart'])
  if (!validActions.has(action)) {
    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  }

  try {
    if (action === 'stop') {
      if (instanceId) {
        stopInstance(instanceId)
        return NextResponse.json({ success: true, status: 'stopped', instanceId })
      }
      stopAll()
      return NextResponse.json({ success: true, status: 'stopped' })
    }

    if (action === 'start') {
      if (instanceId) {
        const { port, pid } = await startInstance(instanceId)
        return NextResponse.json({ success: true, status: 'starting', instanceId, port, pid })
      }
      const results = await startAll()
      return NextResponse.json({ success: true, status: 'starting', instances: results })
    }

    if (action === 'restart') {
      if (instanceId) {
        const { port, pid } = await restartInstance(instanceId)
        return NextResponse.json({ success: true, status: 'starting', instanceId, port, pid })
      }
      stopAll()
      const results = await startAll()
      return NextResponse.json({ success: true, status: 'starting', instances: results })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
