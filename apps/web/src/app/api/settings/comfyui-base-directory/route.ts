import { NextRequest, NextResponse } from 'next/server'
import { existsSync, statSync } from 'fs'
import { getRequestUser } from '@/lib/auth'
import { getComfyBaseDirectory, setComfyBaseDirectory } from '@/lib/providerSettings'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  return NextResponse.json({ baseDirectory: getComfyBaseDirectory() ?? null })
}

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { baseDirectory } = (await req.json()) as { baseDirectory?: string | null }
  if (baseDirectory != null && typeof baseDirectory !== 'string') {
    return NextResponse.json({ error: 'baseDirectory must be a string or null' }, { status: 400 })
  }

  const trimmed = (baseDirectory ?? '').trim()
  if (trimmed) {
    // Only accept if the directory exists and is actually a directory.
    if (!existsSync(trimmed)) {
      return NextResponse.json({ error: `Directory not found: ${trimmed}` }, { status: 400 })
    }
    try {
      if (!statSync(trimmed).isDirectory()) {
        return NextResponse.json({ error: `Not a directory: ${trimmed}` }, { status: 400 })
      }
    } catch {
      return NextResponse.json({ error: `Unable to read: ${trimmed}` }, { status: 400 })
    }
  }

  setComfyBaseDirectory(trimmed)
  return NextResponse.json({ ok: true, baseDirectory: getComfyBaseDirectory() ?? null })
}
