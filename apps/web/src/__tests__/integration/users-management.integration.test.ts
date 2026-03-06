import { describe, it, expect, vi, beforeEach } from 'vitest'
import crypto from 'crypto'
import { createTestDb, seedAdmin, createTestSession, makeRequest } from './setup'
import type { TestDb } from './setup'
import { users } from '../../lib/db/schema'

let db: TestDb

vi.mock('../../lib/db', () => ({
  getDb: () => db,
}))

import { GET as getUsers, POST as createUser } from '../../app/api/users/route'
import { PATCH as patchUser, DELETE as deleteUser } from '../../app/api/users/[id]/route'

describe('Users management integration', () => {
  let admin: ReturnType<typeof seedAdmin>
  let adminToken: string

  beforeEach(() => {
    db = createTestDb()
    admin = seedAdmin(db)
    adminToken = createTestSession(db, admin.id)
  })

  function authedReq(url: string, init?: any) {
    return makeRequest(url, {
      ...init,
      cookies: { fs_session: adminToken },
    })
  }

  // ── GET /api/users ───────────────────────────────────────────────────

  it('GET /api/users lists all users for admin', async () => {
    const res = await getUsers(authedReq('/api/users'))
    expect(res.status).toBe(200)
    const users = await res.json()
    expect(users.length).toBe(1) // just the seeded admin
    expect(users[0].username).toBe('admin')
    // Should not expose passwordHash
    expect(users[0].passwordHash).toBeUndefined()
  })

  it('GET /api/users returns 403 without auth', async () => {
    const res = await getUsers(makeRequest('/api/users'))
    expect(res.status).toBe(403)
  })

  it('GET /api/users returns 403 for non-manager role', async () => {
    // Create an artist user
    const artistReq = authedReq('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'artist1', password: 'securepass', role: 'artist' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const artistRes = await createUser(artistReq)
    const artist = await artistRes.json()

    const artistToken = createTestSession(db, artist.id)
    const res = await getUsers(makeRequest('/api/users', { cookies: { fs_session: artistToken } }))
    expect(res.status).toBe(403)
  })

  // ── POST /api/users ──────────────────────────────────────────────────

  it('POST /api/users creates an active user (admin bypass)', async () => {
    const req = authedReq('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'dev1', password: 'devpassword', role: 'dev' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await createUser(req)
    expect(res.status).toBe(201)
    const user = await res.json()
    expect(user.username).toBe('dev1')
    expect(user.status).toBe('active') // admin-created users are active immediately
  })

  it('POST /api/users rejects duplicate username', async () => {
    const req = authedReq('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'password123', role: 'dev' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await createUser(req)
    expect(res.status).toBe(409)
  })

  it('POST /api/users returns 400 for missing fields', async () => {
    const req = authedReq('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'incomplete' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await createUser(req)
    expect(res.status).toBe(400)
  })

  // ── PATCH /api/users/[id] ────────────────────────────────────────────

  it('PATCH updates user role', async () => {
    // Create a dev user
    const createReq = authedReq('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'dev1', password: 'password123', role: 'dev' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const created = await (await createUser(createReq)).json()

    const req = authedReq(`/api/users/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'pipeline_td' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchUser(req, { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(200)
    const user = await res.json()
    expect(user.role).toBe('pipeline_td')
  })

  it('PATCH approves a pending user', async () => {
    // Create pending user via direct DB insert
    const userId = crypto.randomUUID()
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.pbkdf2Sync('password123', salt, 100000, 64, 'sha512').toString('hex')
    db.insert(users).values({
      id: userId, username: 'pending1', passwordHash: `${salt}:${hash}`,
      role: 'artist', status: 'pending', createdAt: Date.now(),
    }).run()

    const req = authedReq(`/api/users/${userId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'active' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchUser(req, { params: Promise.resolve({ id: userId }) })
    expect(res.status).toBe(200)
    const user = await res.json()
    expect(user.status).toBe('active')
    expect(user.approvedAt).toBeDefined()
    expect(user.approvedBy).toBe(admin.id)
  })

  it('PATCH rejects invalid role', async () => {
    const createReq = authedReq('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'dev2', password: 'password123', role: 'dev' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const created = await (await createUser(createReq)).json()

    const req = authedReq(`/api/users/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'superuser' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchUser(req, { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(400)
  })

  it('PATCH rejects invalid status', async () => {
    const createReq = authedReq('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'dev3', password: 'password123', role: 'dev' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const created = await (await createUser(createReq)).json()

    const req = authedReq(`/api/users/${created.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'banned' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchUser(req, { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(400)
  })

  it('PATCH prevents demoting the last admin', async () => {
    const req = authedReq(`/api/users/${admin.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ role: 'dev' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchUser(req, { params: Promise.resolve({ id: admin.id }) })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('last admin')
  })

  it('PATCH returns 404 for non-existent user', async () => {
    const req = authedReq('/api/users/missing-id', {
      method: 'PATCH',
      body: JSON.stringify({ role: 'dev' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const res = await patchUser(req, { params: Promise.resolve({ id: 'missing-id' }) })
    expect(res.status).toBe(404)
  })

  // ── DELETE /api/users/[id] ───────────────────────────────────────────

  it('DELETE removes a user', async () => {
    const createReq = authedReq('/api/users', {
      method: 'POST',
      body: JSON.stringify({ username: 'todelete', password: 'password123', role: 'artist' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const created = await (await createUser(createReq)).json()

    const req = authedReq(`/api/users/${created.id}`, { method: 'DELETE' })
    const res = await deleteUser(req, { params: Promise.resolve({ id: created.id }) })
    expect(res.status).toBe(200)
  })

  it('DELETE prevents self-deletion', async () => {
    const req = authedReq(`/api/users/${admin.id}`, { method: 'DELETE' })
    const res = await deleteUser(req, { params: Promise.resolve({ id: admin.id }) })
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('own account')
  })

  it('DELETE returns 404 for non-existent user', async () => {
    const req = authedReq('/api/users/missing-id', { method: 'DELETE' })
    const res = await deleteUser(req, { params: Promise.resolve({ id: 'missing-id' }) })
    expect(res.status).toBe(404)
  })

  it('DELETE returns 403 without auth', async () => {
    const req = makeRequest('/api/users/some-id', { method: 'DELETE' })
    const res = await deleteUser(req, { params: Promise.resolve({ id: 'some-id' }) })
    expect(res.status).toBe(403)
  })
})
