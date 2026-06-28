import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { installedApps } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseManifest } from '@/lib/appManifest'
import { getRequestUser } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APPS_DIR = path.join(os.homedir(), '.flowscale', 'apps')
const SAFE_ID_RE = /^[a-zA-Z0-9_-]+$/

type Params = { params: Promise<{ id: string }> }

export async function GET(req: NextRequest, { params }: Params) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { id } = await params
  if (!SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid app id' }, { status: 400 })
  }
  const bundlePath = path.join(APPS_DIR, id)
  const manifestPath = path.join(bundlePath, 'flowscale.app.json')

  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 })
  }

  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    const manifest = parseManifest(raw)

    // Optional DB metadata
    const db = getDb()
    const [dbRow] = await db.select().from(installedApps).where(eq(installedApps.id, id))

    return NextResponse.json({
      id,
      name: manifest.name,
      displayName: manifest.displayName,
      bundlePath,
      entryPath: manifest.entry,
      manifestJson: JSON.stringify(manifest),
      source: dbRow?.source ?? 'local',
      status: 'active',
      installedAt: dbRow?.installedAt ?? fs.statSync(bundlePath).mtimeMs,
      manifest,
    })
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'dev'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  if (!SAFE_ID_RE.test(id)) {
    return NextResponse.json({ error: 'Invalid app id' }, { status: 400 })
  }
  const bundlePath = path.join(APPS_DIR, id)

  // Remove DB record if exists (cascades to app_storage)
  const db = getDb()
  await db.delete(installedApps).where(eq(installedApps.id, id))

  // Remove the app directory from disk
  if (fs.existsSync(bundlePath)) {
    fs.rmSync(bundlePath, { recursive: true, force: true })
  }

  return NextResponse.json({ ok: true })
}
