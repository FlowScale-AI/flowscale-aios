import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'
import { getDb } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { getRequestUser, hasManagerRole, hashPassword } from '@/lib/auth'

export async function GET(req: NextRequest) {
  const actor = getRequestUser(req)
  if (!actor || !hasManagerRole(actor.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const db = getDb()
  const rows = db.select().from(users).all()
  rows.sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))

  return NextResponse.json(
    rows.map((u) => ({
      id: u.id,
      username: u.username,
      role: u.role,
      status: u.status,
      createdAt: u.createdAt,
      approvedAt: u.approvedAt,
      approvedBy: u.approvedBy,
    })),
  )
}

export async function POST(req: NextRequest) {
  const actor = getRequestUser(req)
  if (!actor || !hasManagerRole(actor.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { username, password, role } = await req.json()

  if (!username || !password || !role) {
    return NextResponse.json({ error: 'Username, password, and role required' }, { status: 400 })
  }

  const db = getDb()
  const existing = db.select().from(users).where(eq(users.username, username)).get()
  if (existing) {
    return NextResponse.json({ error: 'Username already taken' }, { status: 409 })
  }

  const id = crypto.randomUUID()
  const passwordHash = hashPassword(password)
  const now = Date.now()

  db.insert(users)
    .values({ id, username, passwordHash, role, status: 'active', createdAt: now })
    .run()

  const user = db.select().from(users).where(eq(users.id, id)).get()
  return NextResponse.json(user, { status: 201 })
}
