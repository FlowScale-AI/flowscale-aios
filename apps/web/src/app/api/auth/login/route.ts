import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { verifyPassword, createSession, clearSetupPassword } from '@/lib/auth'

export async function POST(req: NextRequest) {
  const { username, password } = await req.json()

  if (!username || !password) {
    return NextResponse.json({ error: 'Username and password required' }, { status: 400 })
  }

  const db = getDb()
  const user = db.select().from(users).where(eq(users.username, username)).get()

  if (!user || !verifyPassword(password, user.passwordHash)) {
    return NextResponse.json({ error: 'Invalid username or password' }, { status: 401 })
  }

  if (user.status === 'pending') {
    return NextResponse.json(
      { error: 'Your account is pending approval by an admin' },
      { status: 403 },
    )
  }

  if (user.status === 'disabled') {
    return NextResponse.json({ error: 'Your account has been disabled' }, { status: 403 })
  }

  const token = createSession(user.id)

  // Clear first-run setup password after admin first login
  clearSetupPassword()

  const response = NextResponse.json({
    user: { id: user.id, username: user.username, role: user.role },
  })

  response.cookies.set('fs_session', token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: 7 * 24 * 60 * 60,
  })

  return response
}
