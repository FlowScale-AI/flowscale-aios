import { type NextRequest, NextResponse } from 'next/server'
import { isValidComfyInstall } from '../utils'

export async function GET(req: NextRequest) {
  const checkPath = req.nextUrl.searchParams.get('path')
  if (!checkPath) {
    return NextResponse.json({ error: 'path query param required' }, { status: 400 })
  }
  return NextResponse.json({ valid: isValidComfyInstall(checkPath), path: checkPath })
}
