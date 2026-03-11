import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { installedApps } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
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
  const { id, path: pathSegments } = await params

  const db = getDb()
  const [app] = await db.select().from(installedApps).where(eq(installedApps.id, id))
  if (!app) return NextResponse.json({ error: 'App not found' }, { status: 404 })

  // Prevent path traversal
  const requestedPath = pathSegments.join('/')
  if (requestedPath.includes('..')) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const filePath = path.resolve(app.bundlePath, requestedPath)
  // Double-check resolved path is still inside bundlePath
  if (!filePath.startsWith(path.resolve(app.bundlePath))) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  if (!fs.existsSync(filePath)) {
    return NextResponse.json({ error: 'File not found' }, { status: 404 })
  }

  const content = fs.readFileSync(filePath)
  const mimeType = mimeLookup(filePath) || 'application/octet-stream'
  const cacheControl = app.source === 'sideloaded' ? 'no-store, no-cache' : 'max-age=3600'

  return new NextResponse(content, {
    headers: {
      'Content-Type': mimeType,
      'Cache-Control': cacheControl,
    },
  })
}
