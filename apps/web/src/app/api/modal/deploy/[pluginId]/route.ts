import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import {
  deployToModal,
  undeployFromModal,
  getDeployments,
  getDeploymentById,
  getModalLogs,
  isDeploying,
  validateGpuTier,
} from '@/lib/modal-deploy'
import { getPlugin, VALID_GPU_TIERS } from '@/lib/toolPlugins'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

async function checkHealth(url: string): Promise<boolean> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/health`, {
      signal: AbortSignal.timeout(5000),
    })
    return res.ok
  } catch {
    return false
  }
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pluginId } = await params

  // Check if the plugin supports Modal
  const plugin = getPlugin(pluginId)
  const supported =
    plugin?.cloud?.modal?.supported === true &&
    existsSync(join(homedir(), '.flowscale', 'tool-plugins', pluginId, 'modal_app.py'))

  const rawDeployments = getDeployments(pluginId)

  // Health-check deployed instances. When ?target= is set, only check that one.
  // When no target (Auto or initial load), check all deployed instances.
  const targetId = req.nextUrl.searchParams.get('target')
  const skipHealth = req.nextUrl.searchParams.get('health') === 'false'
  const deployments = await Promise.all(
    rawDeployments.map(async (d) => {
      if (skipHealth || d.status !== 'deployed' || !d.url) {
        return { ...d, warm: null as boolean | null }
      }
      // Check this deployment if: no target filter, or it matches the filter
      if (!targetId || d.id === targetId) {
        const warm = await checkHealth(d.url)
        return { ...d, warm }
      }
      return { ...d, warm: null as boolean | null }
    }),
  )

  // Only fetch full logs (deploy + runtime) when actively checking — costs ~3s subprocess
  const includeLogs = req.nextUrl.searchParams.get('logs') !== 'false'
  const logs = includeLogs ? await getModalLogs(pluginId) : ''

  return NextResponse.json({
    supported,
    defaultGpu: plugin?.cloud?.modal?.defaultGpu ?? 'A10',
    deployments,
    logs,
  })
}

const DEPLOY_NAME_RE = /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ pluginId: string }> },
) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pluginId } = await params
  const body = await req.json()
  const { action } = body

  if (action === 'deploy') {
    const { gpu, name } = body as { gpu: string; name: string }

    if (!gpu || !validateGpuTier(gpu)) {
      return NextResponse.json(
        { error: `Invalid GPU tier. Valid: ${VALID_GPU_TIERS.join(', ')}` },
        { status: 400 },
      )
    }

    if (!name || !DEPLOY_NAME_RE.test(name)) {
      return NextResponse.json(
        {
          error:
            'Invalid deployment name. Must match /^[a-z0-9][a-z0-9-]{0,62}[a-z0-9]$/ (lowercase alphanumeric and hyphens, 2–64 chars).',
        },
        { status: 400 },
      )
    }

    const existing = getDeployments(pluginId)

    // Check name uniqueness
    if (existing.some((d) => d.name === name)) {
      return NextResponse.json(
        { error: `A deployment named "${name}" already exists for this plugin.` },
        { status: 409 },
      )
    }

    // Check no deploying instances
    if (isDeploying(pluginId)) {
      return NextResponse.json(
        { error: 'Deployment already in progress' },
        { status: 409 },
      )
    }

    // Fire and forget — status polling picks up progress
    deployToModal(pluginId, gpu, name, name).catch((err) => {
      console.error(`Modal deploy failed for ${pluginId}:`, err)
    })

    return NextResponse.json({ status: 'deploying', gpu, name }, { status: 202 })
  }

  if (action === 'undeploy') {
    const { deployId } = body as { deployId: string }

    if (!deployId) {
      return NextResponse.json({ error: 'deployId is required' }, { status: 400 })
    }

    const record = getDeploymentById(pluginId, deployId)
    if (!record) {
      return NextResponse.json(
        { error: `Deployment "${deployId}" not found` },
        { status: 404 },
      )
    }

    const result = await undeployFromModal(pluginId, deployId)
    if (!result.success) {
      return NextResponse.json({ error: result.error }, { status: 500 })
    }
    return NextResponse.json({ success: true })
  }

  return NextResponse.json({ error: 'Invalid action' }, { status: 400 })
}
