import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getComfyInstances } from '@/lib/providerSettings'
import { getListeningPortOwners } from '@/lib/process-utils'
import { killProcessTree } from '@/lib/comfyui-manager'
import { probePort } from '@/lib/comfy-probe'

/**
 * POST /api/comfy/external/stop
 *
 * Stops a ComfyUI instance that AIOS didn't launch, by resolving the port's
 * owning PID and killing its process tree. Gated behind UI confirmation — the
 * user is killing a process they started (ComfyUI Desktop, portable launcher,
 * etc.), which is more invasive than stopping an AIOS-managed instance.
 *
 * Rejects ports that belong to a managed instance to avoid a corner case where
 * a managed instance's reattributed port shows up as external in some consumer.
 */
export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = (await req.json().catch(() => null)) as { port?: unknown } | null
  const port = typeof body?.port === 'number' ? body.port : Number(body?.port)
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return NextResponse.json({ error: 'Valid port required' }, { status: 400 })
  }

  // Don't let this endpoint kill AIOS-managed instances — the regular
  // /api/comfy/manage stop action is the correct way to do that, and this
  // route doesn't clean up PID files or update state.
  const managedPorts = new Set(getComfyInstances().map((i) => i.port))
  if (managedPorts.has(port)) {
    return NextResponse.json(
      { error: `Port ${port} belongs to a managed instance — use the managed stop button` },
      { status: 400 },
    )
  }

  // Confirm there's actually a ComfyUI on that port before killing — guards
  // against stopping an arbitrary process if the client passed the wrong port.
  const probe = await probePort(port)
  if (!probe) {
    return NextResponse.json(
      { error: `No ComfyUI responding on port ${port}` },
      { status: 404 },
    )
  }

  const owners = await getListeningPortOwners()
  const pid = owners.get(port)
  if (!pid) {
    return NextResponse.json(
      { error: `Could not resolve owner PID for port ${port}` },
      { status: 500 },
    )
  }

  killProcessTree(pid)
  return NextResponse.json({ success: true, port, pid })
}
