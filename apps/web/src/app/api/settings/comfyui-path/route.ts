import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { getComfyManagedPath, setComfyManagedPath } from '@/lib/providerSettings'
import { normalizeComfyPathInput } from './normalize'
import { isValidComfyInstall, resolveComfyPath } from '@/app/api/comfy/setup/utils'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  // Read the same key spawns use, so the UI shows the path that will actually
  // be launched.
  const comfyuiPath = getComfyManagedPath()
  return NextResponse.json({ comfyuiPath: comfyuiPath ?? null })
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { comfyuiPath } = (await req.json()) as { comfyuiPath: string }
  if (!comfyuiPath || typeof comfyuiPath !== 'string') {
    return NextResponse.json({ error: 'comfyuiPath required' }, { status: 400 })
  }

  // Normalize common user mistakes (trailing main.py, .app bundle, surrounding
  // quotes/whitespace), then resolve env vars and try to find the real ComfyUI
  // root if the user pointed at a wrapper directory.
  const normalized = normalizeComfyPathInput(comfyuiPath)
  if (!normalized) {
    return NextResponse.json({ error: 'comfyuiPath required' }, { status: 400 })
  }
  const resolved = resolveComfyPath(normalized)
  if (!isValidComfyInstall(resolved)) {
    return NextResponse.json(
      {
        error: `"${resolved}" is not a valid ComfyUI installation (no main.py / pyproject.toml). Browse to the directory containing ComfyUI's main.py.`,
      },
      { status: 400 },
    )
  }

  // Write `comfyManagedPath` (which spawns read) AND legacy `comfyuiPath` —
  // setComfyManagedPath does both. Previously this used setComfyUIPath which
  // only updated the legacy key, leaving stale comfyManagedPath shadowing
  // the saved value.
  setComfyManagedPath(resolved)
  return NextResponse.json({ ok: true, comfyuiPath: resolved })
}
