import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { installedApps, appStorage } from '@/lib/db/schema'
import { eq, and } from 'drizzle-orm'
import { getRequestUser } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json() as {
    appId: string
    action: 'get' | 'set' | 'delete' | 'keys'
    key?: string
    value?: unknown
    scope?: string
  }
  const { appId, action, key, value } = body

  if (!appId || !action) {
    return NextResponse.json({ error: 'appId and action are required' }, { status: 400 })
  }

  const db = getDb()

  // Verify app exists
  const [app] = await db.select().from(installedApps).where(eq(installedApps.id, appId))
  if (!app) return NextResponse.json({ error: 'App not found' }, { status: 404 })

  switch (action) {
    case 'get': {
      if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
      const [row] = await db
        .select()
        .from(appStorage)
        .where(and(eq(appStorage.appId, appId), eq(appStorage.key, key)))
      if (!row) return NextResponse.json(null)
      try {
        return NextResponse.json(JSON.parse(row.value))
      } catch {
        return NextResponse.json(row.value)
      }
    }

    case 'set': {
      if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
      const serialized = JSON.stringify(value)
      await db
        .insert(appStorage)
        .values({ appId, key, value: serialized, updatedAt: Date.now() })
        .onConflictDoUpdate({
          target: [appStorage.appId, appStorage.key],
          set: { value: serialized, updatedAt: Date.now() },
        })
      return NextResponse.json({ ok: true })
    }

    case 'delete': {
      if (!key) return NextResponse.json({ error: 'key required' }, { status: 400 })
      await db
        .delete(appStorage)
        .where(and(eq(appStorage.appId, appId), eq(appStorage.key, key)))
      return NextResponse.json({ ok: true })
    }

    case 'keys': {
      const rows = await db
        .select({ key: appStorage.key })
        .from(appStorage)
        .where(eq(appStorage.appId, appId))
      return NextResponse.json(rows.map((r) => r.key))
    }

    default:
      return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 })
  }
}
