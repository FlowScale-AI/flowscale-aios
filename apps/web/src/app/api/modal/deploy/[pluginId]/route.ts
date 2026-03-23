import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import {
  deployToModal,
  undeployFromModal,
  getModalDeployStatus,
  isDeploying,
  validateGpuTier,
} from '@/lib/modal-deploy'
import { getPlugin } from '@/lib/toolPlugins'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pluginId } = await params

  // Check if the plugin supports Modal
  const plugin = getPlugin(pluginId)
  const modalSupported = plugin?.cloud?.modal?.supported === true
    && existsSync(join(homedir(), '.flowscale', 'tool-plugins', pluginId, 'modal_app.py'))

  const status = await getModalDeployStatus(pluginId)
  return NextResponse.json({
    ...status,
    supported: modalSupported,
    defaultGpu: plugin?.cloud?.modal?.defaultGpu ?? 'A10G',
  })
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pluginId } = await params
  const body = await req.json()
  const { action, gpu } = body

  if (action === 'deploy') {
    if (!gpu || !validateGpuTier(gpu)) {
      return NextResponse.json(
        { error: `Invalid GPU tier. Valid: T4, A10G, L4, A100, H100` },
        { status: 400 },
      )
    }

    if (isDeploying(pluginId)) {
      return NextResponse.json(
        { error: 'Deployment already in progress' },
        { status: 409 },
      )
    }

    // Fire and forget — status polling picks up progress
    deployToModal(pluginId, gpu).catch((err) => {
      console.error(`Modal deploy failed for ${pluginId}:`, err)
    })

    return NextResponse.json({ status: 'deploying', gpu }, { status: 202 })
  }

  if (action === 'undeploy') {
    const result = await undeployFromModal(pluginId)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
