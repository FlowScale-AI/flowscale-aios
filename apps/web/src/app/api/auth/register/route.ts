import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import crypto from 'crypto'
import { getDb } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { hashPassword } from '@/lib/auth'

const ALLOWED_ROLES = ['dev', 'artist']

export async function POST(req: NextRequest) {
  const { username, password, role } = await req.json()

  if (!username || !password || !role) {
    return NextResponse.json({ error: 'Username, password, and role required' }, { status: 400 })
  }

  if (!ALLOWED_ROLES.includes(role)) {
    return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
  }

  if (username.length < 3 || username.length > 32) {
    return NextResponse.json({ error: 'Username must be 3–32 characters' }, { status: 400 })
  }

  if (password.length < 8) {
    return NextResponse.json({ error: 'Password must be at least 8 characters' }, { status: 400 })
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
    .values({ id, username, passwordHash, role, status: 'pending', createdAt: now })
    .run()

  return NextResponse.json({ ok: true }, { status: 201 })
}
