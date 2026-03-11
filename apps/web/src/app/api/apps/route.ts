import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { installedApps } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { parseManifest } from '@/lib/appManifest'
import { getRequestUser } from '@/lib/auth'
import fs from 'fs'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const source = req.nextUrl.searchParams.get('source')

  const condition = source
    ? and(eq(installedApps.status, 'active'), eq(installedApps.source, source))
    : eq(installedApps.status, 'active')

  const rows = await db.select().from(installedApps).where(condition)

  const apps = rows
    .filter((row) => fs.existsSync(row.bundlePath))
    .map((row) => {
      try {
        const manifest = parseManifest(JSON.parse(row.manifestJson))
        return { ...row, manifest }
      } catch {
        return { ...row, manifest: null }
      }
    })

  return NextResponse.json(apps)
}
