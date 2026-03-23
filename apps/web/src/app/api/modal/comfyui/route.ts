import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import {
  getModalComfyInstances,
  getModalComfyById,
  addModalComfyInstance,
  removeModalComfyInstance,
  allocateVirtualPort,
  isModalComfyDeploying,
} from '@/lib/modal-comfyui'
import { validateGpuTier } from '@/lib/modal-deploy'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const instances = getModalComfyInstances()
  return NextResponse.json({ instances })
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()
  const { action } = body

  if (action === 'deploy') {
    const { gpu, name } = body as { gpu: string; name: string }

    if (!gpu || !validateGpuTier(gpu)) {
      return NextResponse.json({ error: 'Invalid GPU tier' }, { status: 400 })
    }
    if (!name || !NAME_RE.test(name)) {
      return NextResponse.json({ error: 'Invalid name' }, { status: 400 })
    }

    const existing = getModalComfyInstances()
    if (existing.some(i => i.name === name)) {
      return NextResponse.json({ error: 'Name already exists' }, { status: 409 })
    }
    if (isModalComfyDeploying()) {
      return NextResponse.json({ error: 'Another deployment in progress' }, { status: 409 })
    }

    const virtualPort = allocateVirtualPort()
    const appName = `flowscale-${name}`

    addModalComfyInstance({
      id: name,
      name,
      status: 'deploying',
      gpu,
      virtualPort,
      appName,
      url: '',
      deployedAt: Date.now(),
    })

    // TODO: Fire and forget deploy via helper (Task 10 will implement the actual template)
    // For now, just mark as deploying

    return NextResponse.json({ status: 'deploying', name, gpu, virtualPort }, { status: 202 })
  }

  if (action === 'undeploy') {
    const { instanceId } = body as { instanceId: string }
    if (!instanceId) return NextResponse.json({ error: 'instanceId required' }, { status: 400 })

    const instance = getModalComfyById(instanceId)
    if (!instance) return NextResponse.json({ error: 'Instance not found' }, { status: 404 })

    // Call modal helper to undeploy
    // For now, just remove the record
    removeModalComfyInstance(instanceId)
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
