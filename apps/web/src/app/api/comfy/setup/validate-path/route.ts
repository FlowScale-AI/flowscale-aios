import { type NextRequest, NextResponse } from 'next/server'
import fs from 'fs'
import path from 'path'

/** A path is a valid ComfyUI installation if it contains main.py and pyproject.toml. */
export function isValidComfyInstall(dirPath: string): boolean {
  if (!dirPath || !fs.existsSync(dirPath)) return false
  return (
    fs.existsSync(path.join(dirPath, 'main.py')) &&
    fs.existsSync(path.join(dirPath, 'pyproject.toml'))
  )
}

export async function GET(req: NextRequest) {
  const checkPath = req.nextUrl.searchParams.get('path')
  if (!checkPath) {
    return NextResponse.json({ error: 'path query param required' }, { status: 400 })
  }
  return NextResponse.json({ valid: isValidComfyInstall(checkPath), path: checkPath })
}
