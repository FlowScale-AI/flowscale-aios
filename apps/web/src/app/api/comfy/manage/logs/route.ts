import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getInstanceLogTail } from '@/lib/comfyui-manager'
import { getComfyInstances } from '@/lib/providerSettings'

/**
 * GET /api/comfy/manage/logs?instanceId=cpu
 * Returns the tail of a managed instance's spawn log. Used to surface crash
 * causes when the process exits unexpectedly.
 */
export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const url = new URL(req.url)
  const instanceId = url.searchParams.get('instanceId')
  if (!instanceId) {
    return NextResponse.json({ error: 'instanceId required' }, { status: 400 })
  }

  // Whitelist against configured instance IDs to prevent path traversal
  // (instanceId becomes part of a filesystem path via logFile()).
  const known = new Set(getComfyInstances().map((i) => i.id))
  if (!known.has(instanceId)) {
    return NextResponse.json({ error: 'Unknown instanceId' }, { status: 404 })
  }

  const log = getInstanceLogTail(instanceId)
  return NextResponse.json({ instanceId, log: log ?? null })
}
