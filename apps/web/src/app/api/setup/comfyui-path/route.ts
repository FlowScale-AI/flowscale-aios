import { NextRequest, NextResponse } from 'next/server'
import { setComfyUIPath } from '@/lib/providerSettings'

/**
 * POST /api/setup/comfyui-path
 * Saves the ComfyUI installation path during first-run setup.
 * No auth required — only used during setup wizard.
 */
export async function POST(req: NextRequest) {
  const { comfyuiPath } = (await req.json()) as { comfyuiPath: string }
  if (!comfyuiPath || typeof comfyuiPath !== 'string') {
    return NextResponse.json({ error: 'comfyuiPath required' }, { status: 400 })
  }

  setComfyUIPath(comfyuiPath.trim())
  return NextResponse.json({ ok: true, comfyuiPath: comfyuiPath.trim() })
}
