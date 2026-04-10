import { type NextRequest, NextResponse } from 'next/server'
import { isValidComfyInstall, resolveComfyPath } from '../utils'

export async function GET(req: NextRequest) {
  const checkPath = req.nextUrl.searchParams.get('path')
  if (!checkPath) {
    return NextResponse.json({ error: 'path query param required' }, { status: 400 })
  }
  const resolved = resolveComfyPath(checkPath)
  return NextResponse.json({
    valid: isValidComfyInstall(resolved),
    path: checkPath,
    // If we resolved to a different path, tell the client so it can update the input
    ...(resolved !== checkPath ? { resolvedPath: resolved } : {}),
  })
}
