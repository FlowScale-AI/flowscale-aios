import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { models } from '@/lib/db/schema'
import { asc } from 'drizzle-orm'
import { getRequestUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const db = getDb()
  const rows = await db
    .select()
    .from(models)
    .orderBy(asc(models.type), asc(models.filename))

  return NextResponse.json(rows)
}
