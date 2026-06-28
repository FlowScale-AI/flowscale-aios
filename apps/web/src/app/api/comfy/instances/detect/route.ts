import { NextResponse } from 'next/server'
import { getComfyInstances } from '@/lib/providerSettings'
import { detectAndUpdateInstances } from '@/lib/comfy-instance-detect'

/**
 * POST /api/comfy/instances/detect
 *
 * Detects available GPUs, generates an instance config (one per GPU + one CPU),
 * saves to settings, and returns the result.
 */
export async function POST() {
  const result = detectAndUpdateInstances({ forceClearCache: true })
  return NextResponse.json({
    gpus: result.gpus,
    instances: result.instances,
    ...(result.warning ? { warning: result.warning } : {}),
  })
}

/**
 * GET /api/comfy/instances/detect
 *
 * Returns current instance config without re-detecting.
 */
export async function GET() {
  const instances = getComfyInstances()
  return NextResponse.json({ instances })
}
