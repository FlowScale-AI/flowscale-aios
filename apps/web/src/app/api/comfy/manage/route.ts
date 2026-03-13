import { NextResponse } from 'next/server'
import { getProcessStatus, startComfyUI, stopComfyUI, restartComfyUI } from '@/lib/comfyui-manager'
import { getComfyManagedPath, getComfyInstallType } from '@/lib/providerSettings'
import { probePort } from '@/lib/comfy-probe'

export async function GET() {
  const { alive, pid, port } = getProcessStatus()
  const managedPath = getComfyManagedPath()
  const installType = getComfyInstallType()

  let status: 'running' | 'starting' | 'stopped'
  if (!alive) {
    status = 'stopped'
  } else {
    // Process is alive — check if HTTP is already up
    const httpReady = !!(await probePort(port))
    status = httpReady ? 'running' : 'starting'
  }

  return NextResponse.json({
    status,
    pid: pid ?? undefined,
    port,
    managedPath: managedPath ?? null,
    installType: installType ?? null,
    isSetup: !!managedPath,
  })
}

export async function POST(req: Request) {
  const { action } = await req.json() as { action: 'start' | 'stop' | 'restart' }

  try {
    if (action === 'stop') {
      stopComfyUI()
      return NextResponse.json({ success: true, status: 'stopped' })
    }

    if (action === 'start') {
      const { port, pid } = startComfyUI()
      return NextResponse.json({ success: true, status: 'starting', port, pid })
    }

    if (action === 'restart') {
      const { port, pid } = restartComfyUI()
      return NextResponse.json({ success: true, status: 'starting', port, pid })
    }

    return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }
}
