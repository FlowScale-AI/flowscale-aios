import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'fs'
import { getRequestUser } from '@/lib/auth'
import { getComfyPythonPath, setComfyPythonPath } from '@/lib/providerSettings'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({ pythonPath: getComfyPythonPath() ?? null })
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { pythonPath } = (await req.json()) as { pythonPath?: string | null }
  if (pythonPath != null && typeof pythonPath !== 'string') {
    return NextResponse.json({ error: 'pythonPath must be a string or null' }, { status: 400 })
  }

  const trimmed = (pythonPath ?? '').trim()
  if (trimmed) {
    // Only accept if the file actually exists and is a regular file (not a directory).
    if (!existsSync(trimmed)) {
      return NextResponse.json({ error: `File not found: ${trimmed}` }, { status: 400 })
    }
    try {
      if (!statSync(trimmed).isFile()) {
        return NextResponse.json({ error: `Not a file: ${trimmed}` }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: `Unable to read: ${trimmed}` }, { status: 400 })
    }
  }

  setComfyPythonPath(trimmed)
  return NextResponse.json({ ok: true, pythonPath: getComfyPythonPath() ?? null })
}
