import { NextRequest, NextResponse } from 'next/server'
import { getRequestUser } from '@/lib/auth'
import { parseManifest } from '@/lib/appManifest'
import { getDb } from '@/lib/db'
import { installedApps } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import fs from 'fs'
import path from 'path'
import os from 'os'

const APPS_DIR = path.join(os.homedir(), '.flowscale', 'apps')

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!fs.existsSync(APPS_DIR)) {
    return NextResponse.json([])
  }

  const db = getDb()

  // Build a map of DB records for optional metadata (source, installedAt)
  const dbRows = await db.select().from(installedApps)
  const dbById = new Map(dbRows.map((r) => [r.id, r]))
  const dbByPath = new Map(dbRows.map((r) => [r.bundlePath, r]))

  const apps = []

  for (const dir of fs.readdirSync(APPS_DIR)) {
    const bundlePath = path.join(APPS_DIR, dir)
    try {
      if (!fs.statSync(bundlePath).isDirectory()) continue
    } catch {
      continue
    }

    const manifestPath = path.join(bundlePath, 'flowscale.app.json')
    if (!fs.existsSync(manifestPath)) continue

    try {
      const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
      const manifest = parseManifest(raw)

      // Check for DB record by id or by bundlePath
      const dbRow = dbById.get(dir) ?? dbByPath.get(bundlePath)

      apps.push({
        id: dir,
        name: manifest.name,
        displayName: manifest.displayName,
        bundlePath,
        entryPath: manifest.entry,
        manifestJson: JSON.stringify(manifest),
        source: dbRow?.source ?? 'local',
        status: 'active',
        installedAt: dbRow?.installedAt ?? getDirectoryMtime(bundlePath),
        manifest,
      })
    } catch {
      // Skip malformed manifests
    }
  }

  return NextResponse.json(apps)
}

function getDirectoryMtime(dirPath: string): number {
  try {
    return fs.statSync(dirPath).mtimeMs
  } catch {
    return Date.now()
  }
}
