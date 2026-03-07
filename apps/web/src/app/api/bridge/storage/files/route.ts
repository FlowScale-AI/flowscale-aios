import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { installedApps } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { getRequestUser } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APP_DATA_ROOT = path.join(os.homedir(), '.flowscale', 'aios', 'app-data')

/** Resolve and validate a path inside the app sandbox. Returns null if unsafe. */
function sandboxedPath(appId: string, filePath: string): string | null {
  if (!filePath || path.isAbsolute(filePath) || filePath.includes('..')) return null
  const base = path.resolve(APP_DATA_ROOT, appId)
  const resolved = path.resolve(base, filePath)
  if (!resolved.startsWith(base + path.sep) && resolved !== base) return null
  return resolved
}

async function requireApp(req: NextRequest, appId: string) {
  const user = getRequestUser(req)
  if (!user) return null
  const db = getDb()
  const [app] = await db.select().from(installedApps).where(eq(installedApps.id, appId))
  return app ?? null
}

// ─── POST /api/bridge/storage/files — write ───────────────────────────────────
export async function POST(req: NextRequest) {
  const body = await req.json() as { appId: string; path: string; data: string }
  const { appId, path: filePath, data } = body

  if (!appId || !filePath || !data) {
    return NextResponse.json({ error: 'appId, path, and data are required' }, { status: 400 })
  }

  const app = await requireApp(req, appId)
  if (!app) return NextResponse.json({ error: 'Unauthorized or app not found' }, { status: 401 })

  const target = sandboxedPath(appId, filePath)
  if (!target) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })

  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, Buffer.from(data, 'base64'))

  const publicUrl = `/api/bridge/storage/files?appId=${encodeURIComponent(appId)}&path=${encodeURIComponent(filePath)}`
  return NextResponse.json({ url: publicUrl })
}

// ─── GET /api/bridge/storage/files — read or list ─────────────────────────────
export async function GET(req: NextRequest) {
  const { searchParams } = req.nextUrl
  const appId = searchParams.get('appId') ?? ''
  const filePath = searchParams.get('path') ?? ''
  const dir = searchParams.get('dir') ?? ''

  if (!appId) return NextResponse.json({ error: 'appId required' }, { status: 400 })

  const app = await requireApp(req, appId)
  if (!app) return NextResponse.json({ error: 'Unauthorized or app not found' }, { status: 401 })

  // List mode
  if (!filePath) {
    const listDir = dir
      ? sandboxedPath(appId, dir)
      : path.resolve(APP_DATA_ROOT, appId)

    if (!listDir) return NextResponse.json({ error: 'Invalid dir' }, { status: 400 })

    if (!fs.existsSync(listDir)) return NextResponse.json([])

    const entries = fs.readdirSync(listDir, { withFileTypes: true })
    const files = entries
      .filter((e) => e.isFile())
      .map((e) => {
        const fullPath = path.join(listDir, e.name)
        const stat = fs.statSync(fullPath)
        const relPath = path.relative(path.resolve(APP_DATA_ROOT, appId), fullPath)
        return {
          path: relPath,
          size: stat.size,
          contentType: guessContentType(e.name),
          createdAt: stat.birthtimeMs,
        }
      })

    return NextResponse.json(files)
  }

  // Read mode
  const target = sandboxedPath(appId, filePath)
  if (!target) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  if (!fs.existsSync(target)) return NextResponse.json({ error: 'File not found' }, { status: 404 })

  const content = fs.readFileSync(target)
  return new NextResponse(content, {
    headers: { 'Content-Type': guessContentType(filePath) },
  })
}

// ─── DELETE /api/bridge/storage/files — delete ────────────────────────────────
export async function DELETE(req: NextRequest) {
  const body = await req.json() as { appId: string; path: string }
  const { appId, path: filePath } = body

  if (!appId || !filePath) {
    return NextResponse.json({ error: 'appId and path are required' }, { status: 400 })
  }

  const app = await requireApp(req, appId)
  if (!app) return NextResponse.json({ error: 'Unauthorized or app not found' }, { status: 401 })

  const target = sandboxedPath(appId, filePath)
  if (!target) return NextResponse.json({ error: 'Invalid path' }, { status: 400 })
  if (!fs.existsSync(target)) return NextResponse.json({ ok: true }) // idempotent

  fs.unlinkSync(target)
  return NextResponse.json({ ok: true })
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.pdf': 'application/pdf',
}

function guessContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}
