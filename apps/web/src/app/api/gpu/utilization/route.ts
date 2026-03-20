import { NextRequest, NextResponse } from 'next/server'
import { getGpuUtilization } from '@/lib/gpu-detect'
import { getRequestUser } from '@/lib/auth'

/**
 * GET /api/gpu/utilization
 * Returns real-time GPU VRAM usage and utilization percentages.
 * Intended to be polled every 3-5 seconds by the UI.
 */
export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const utilization = getGpuUtilization()
  return NextResponse.json(utilization)
}
