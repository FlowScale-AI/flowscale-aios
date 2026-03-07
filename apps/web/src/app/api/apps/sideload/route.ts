import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { installedApps } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'
import { parseManifest } from '@/lib/appManifest'
import { getRequestUser } from '@/lib/auth'
import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  if (!['admin', 'dev'].includes(user.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const body = await req.json() as { path: string }
  const bundlePath = body.path?.trim()

  if (!bundlePath) {
    return NextResponse.json({ error: 'path is required' }, { status: 400 })
  }

  const manifestPath = path.join(bundlePath, 'flowscale.app.json')
  if (!fs.existsSync(manifestPath)) {
    return NextResponse.json(
      { error: `No flowscale.app.json found at ${manifestPath}` },
      { status: 400 },
    )
  }

  let manifest
  try {
    const raw = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'))
    manifest = parseManifest(raw)
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 400 })
  }

  const db = getDb()
  const now = Date.now()

  // Upsert by bundlePath so re-sideloading the same dir updates in place
  const existing = await db
    .select()
    .from(installedApps)
    .where(eq(installedApps.bundlePath, bundlePath))

  if (existing.length > 0) {
    await db
      .update(installedApps)
      .set({
        name: manifest.name,
        displayName: manifest.displayName,
        entryPath: manifest.entry,
        manifestJson: JSON.stringify(manifest),
        status: 'active',
      })
      .where(eq(installedApps.bundlePath, bundlePath))

    const [updated] = await db
      .select()
      .from(installedApps)
      .where(eq(installedApps.bundlePath, bundlePath))
    return NextResponse.json(updated)
  }

  const id = uuidv4()
  await db.insert(installedApps).values({
    id,
    name: manifest.name,
    displayName: manifest.displayName,
    bundlePath,
    entryPath: manifest.entry,
    manifestJson: JSON.stringify(manifest),
    source: 'sideloaded',
    status: 'active',
    installedAt: now,
  })

  const [inserted] = await db.select().from(installedApps).where(eq(installedApps.id, id))
  return NextResponse.json(inserted, { status: 201 })
}
