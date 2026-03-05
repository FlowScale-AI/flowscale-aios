import { NextRequest, NextResponse } from 'next/server'
import { eq } from 'drizzle-orm'
import { getDb } from '@/lib/db'
import { users } from '@/lib/db/schema'
import { getRequestUser, hasManagerRole } from '@/lib/auth'

type Params = { params: Promise<{ id: string }> }

const VALID_ROLES = ['admin', 'pipeline_td', 'dev', 'artist']
const VALID_STATUSES = ['active', 'pending', 'disabled']

export async function PATCH(req: NextRequest, { params }: Params) {
  const actor = getRequestUser(req)
  if (!actor || !hasManagerRole(actor.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params
  const body = await req.json()
  const db = getDb()
  const target = db.select().from(users).where(eq(users.id, id)).get()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  // Prevent demoting the last admin
  if (target.role === 'admin' && body.role && body.role !== 'admin') {
    const activeAdminCount = db
      .select()
      .from(users)
      .where(eq(users.role, 'admin'))
      .all()
      .filter((u) => u.status === 'active').length
    if (activeAdminCount <= 1) {
      return NextResponse.json({ error: 'Cannot demote the last admin' }, { status: 400 })
    }
  }

  const updates: Partial<typeof target> = {}

  if (body.role !== undefined) {
    if (!VALID_ROLES.includes(body.role))
      return NextResponse.json({ error: 'Invalid role' }, { status: 400 })
    updates.role = body.role
  }

  if (body.status !== undefined) {
    if (!VALID_STATUSES.includes(body.status))
      return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
    updates.status = body.status
    if (body.status === 'active' && target.status !== 'active') {
      updates.approvedAt = Date.now()
      updates.approvedBy = actor.id
    }
  }

  db.update(users).set(updates).where(eq(users.id, id)).run()
  const updated = db.select().from(users).where(eq(users.id, id)).get()
  return NextResponse.json(updated)
}

export async function DELETE(req: NextRequest, { params }: Params) {
  const actor = getRequestUser(req)
  if (!actor || !hasManagerRole(actor.role)) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }

  const { id } = await params

  if (id === actor.id) {
    return NextResponse.json({ error: 'Cannot delete your own account' }, { status: 400 })
  }

  const db = getDb()
  const target = db.select().from(users).where(eq(users.id, id)).get()
  if (!target) return NextResponse.json({ error: 'User not found' }, { status: 404 })

  db.delete(users).where(eq(users.id, id)).run()
  return NextResponse.json({ ok: true })
}
