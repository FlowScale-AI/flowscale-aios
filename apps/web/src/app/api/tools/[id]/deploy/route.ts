import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { tools } from '@/lib/db/schema'
import { eq } from 'drizzle-orm'

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const db = getDb()
  const { id } = await params
  const [existing] = await db.select().from(tools).where(eq(tools.id, id))
  if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  // Optionally capture model version from body
  const body = await req.json().catch(() => ({}))
  const modelVersion = body.modelVersion ?? null

  const now = Date.now()
  await db.update(tools).set({
    status: 'production',
    deployedAt: now,
    modelVersion,
    // Increment version if re-deploying
    version: (existing.version ?? 1) + (existing.status === 'production' ? 1 : 0),
  }).where(eq(tools.id, id))

  const [tool] = await db.select().from(tools).where(eq(tools.id, id))
  return NextResponse.json(tool)
}
