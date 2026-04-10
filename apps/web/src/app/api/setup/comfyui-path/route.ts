import { NextRequest, NextResponse } from 'next/server'
import { setComfyUIPath, setComfyDesktopUserDataPath, setComfyInstallType } from '@/lib/providerSettings'

/**
 * POST /api/setup/comfyui-path
 * Saves the ComfyUI installation path during first-run setup.
 * No auth required — only used during setup wizard.
 *
 * Body:
 *   - comfyuiPath: string (required for git clone, optional for desktop-app)
 *   - comfyDesktopUserDataPath?: string (required for desktop-app)
 *   - installType?: 'desktop-app' (if omitted, treated as git clone / github)
 */
export async function POST(req: NextRequest) {
  const body = (await req.json()) as {
    comfyuiPath?: string
    comfyDesktopUserDataPath?: string
    installType?: string
  }

  const isDesktopApp = body.installType === 'desktop-app'

  if (isDesktopApp) {
    if (!body.comfyDesktopUserDataPath || typeof body.comfyDesktopUserDataPath !== 'string') {
      return NextResponse.json({ error: 'comfyDesktopUserDataPath required for Desktop App' }, { status: 400 })
    }
    setComfyDesktopUserDataPath(body.comfyDesktopUserDataPath.trim())
    setComfyInstallType('desktop-app')
    if (body.comfyuiPath?.trim()) {
      setComfyUIPath(body.comfyuiPath.trim())
    }
    return NextResponse.json({
      ok: true,
      installType: 'desktop-app',
      comfyuiPath: body.comfyuiPath?.trim() || null,
      comfyDesktopUserDataPath: body.comfyDesktopUserDataPath.trim(),
    })
  }

  // Git clone / manual install — single path
  if (!body.comfyuiPath || typeof body.comfyuiPath !== 'string') {
    return NextResponse.json({ error: 'comfyuiPath required' }, { status: 400 })
  }
  setComfyUIPath(body.comfyuiPath.trim())
  setComfyInstallType('github')
  return NextResponse.json({ ok: true, comfyuiPath: body.comfyuiPath.trim() })
}
