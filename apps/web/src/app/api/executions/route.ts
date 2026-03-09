import { NextRequest, NextResponse } from 'next/server'
import { getDb } from '@/lib/db'
import { executions } from '@/lib/db/schema'
import { desc } from 'drizzle-orm'
import { getRequestUser } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const user = getRequestUser(req)
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const limit = Math.min(parseInt(req.nextUrl.searchParams.get('limit') ?? '20', 10), 100)

  const db = getDb()
  const rows = await db
    .select()
    .from(executions)
    .orderBy(desc(executions.createdAt))
    .limit(limit)

  return NextResponse.json(rows)
}
