import { type NextRequest, NextResponse } from 'next/server'
import os from 'os'
import path from 'path'
import { isValidComfyInstall } from '../utils'

export async function GET(req: NextRequest) {
  const checkPath = req.nextUrl.searchParams.get('path')
  if (!checkPath) {
    return NextResponse.json({ error: 'path query param required' }, { status: 400 })
  }
  // Restrict to home directory to prevent filesystem information leaks
  const resolved = path.resolve(checkPath)
  const home = os.homedir()
  if (!resolved.startsWith(home + path.sep) && resolved !== home) {
    return NextResponse.json({ valid: false, path: checkPath })
  }
  return NextResponse.json({ valid: isValidComfyInstall(resolved), path: resolved })
}
