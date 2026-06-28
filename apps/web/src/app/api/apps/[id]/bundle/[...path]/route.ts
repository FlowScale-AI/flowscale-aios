import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APPS_DIR = path.join(os.homedir(), '.flowscale', 'apps')
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/

const MIME: Record<string, string> = {
  '.html': 'text/html',
  '.js': 'application/javascript',
  '.mjs': 'application/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
}

function mimeLookup(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}

type Params = { params: Promise<{ id: string; path: string[] }> }

export async function GET(_req: NextRequest, { params }: Params) {
  const user = getRequestUser(_req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id, path: pathSegments } = await params
  if (!SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid app id' }, { status: 400 })
  }

  const bundlePath = path.join(APPS_DIR, id)
  if (!fs.existsSync(bundlePath)) {
    return NextResponse.json({ error: 'App not found' }, { status: 404 })
  }

  // Prevent path traversal
  const requestedPath = pathSegments.join('/')
  if (requestedPath.includes('..')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const filePath = path.resolve(bundlePath, requestedPath)
  // Double-check resolved path is still inside bundlePath
  if (!filePath.startsWith(path.resolve(bundlePath))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const content = fs.readFileSync(filePath)
  const mimeType = mimeLookup(filePath)

  return new NextResponse(content, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': 'no-store',
    },
  })
}
