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
import { getComfyManagedPath, getComfyInstallType } from '@/lib/providerSettings'
import { probePort } from '@/lib/comfy-probe'
import { getRequestUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const managedPath = getComfyManagedPath()
  const installType = getComfyInstallType()
  const statuses = getAllInstanceStatuses()

  // For each instance, determine status:
  // - If PID is alive and HTTP responds → running
  // - If PID is alive but HTTP not ready → starting
  // - If PID is dead, still probe the port (catches externally-started or legacy-PID instances)
  const instances = await Promise.all(
    statuses.map(async (st) => {
      let status: 'running' | 'starting' | 'stopped'
      if (st.alive) {
        const httpReady = !!(await probePort(st.port))
        status = httpReady ? 'running' : 'starting'
      } else {
        // No tracked PID — probe the AIOS-configured port to recover from
        // PID file loss (e.g. hot-reload). If something responds on our port,
        // it's an AIOS-spawned instance whose PID file was cleaned up.
        const httpReady = !!(await probePort(st.port))
        status = httpReady ? 'running' : 'stopped'
      }
      return {
        id: st.id,
        status,
        pid: st.pid ?? undefined,
        port: st.port,
        device: st.device,
        label: st.label,
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
