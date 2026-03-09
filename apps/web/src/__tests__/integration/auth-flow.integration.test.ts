import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createTestDb, seedAdmin, createTestSession, makeRequest } from './setup'
import type { TestDb } from './setup'

let db: TestDb

vi.mock('../../lib/db', () => ({
  getDb: () => db,
}))

import { POST as login } from '../../app/api/auth/login/route'
import { POST as logout } from '../../app/api/auth/logout/route'
import { POST as register } from '../../app/api/auth/register/route'
import { GET as me } from '../../app/api/auth/me/route'
import { POST as changePassword } from '../../app/api/auth/change-password/route'

describe('Auth flow integration', () => {
  let admin: ReturnType<typeof seedAdmin>

  beforeEach(() => {
    db = createTestDb()
    admin = seedAdmin(db)
  })

  // ── Login ────────────────────────────────────────────────────────────

  it('login succeeds with correct credentials and sets cookie', async () => {
    const req = makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'admin123!!' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await login(req)
    expect(res.status).toBe(200)

    const data = await res.json()
    expect(data.user.username).toBe('admin')
    expect(data.user.role).toBe('admin')

    // Check cookie is set
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('fs_session')
  })

  it('login fails with wrong password', async () => {
    const req = makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'wrong' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await login(req)
    expect(res.status).toBe(401)
  })

  it('login fails with non-existent user', async () => {
    const req = makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'nobody', password: 'whatever' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await login(req)
    expect(res.status).toBe(401)
  })

  it('login returns 400 when fields are missing', async () => {
    const req = makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await login(req)
    expect(res.status).toBe(400)
  })

  it('login returns 403 for pending user', async () => {
    // Register a new user (status = pending)
    const regReq = makeRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'newuser', password: 'password123', role: 'artist' }),
      headers: { 'Content-Type': 'application/json' },
    })
    await register(regReq)

    const req = makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'newuser', password: 'password123' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await login(req)
    expect(res.status).toBe(403)
    const data = await res.json()
    expect(data.error).toContain('pending')
  })

  // ── Register ─────────────────────────────────────────────────────────

  it('register creates a pending user', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'artist1', password: 'securepass', role: 'artist' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await register(req)
    expect(res.status).toBe(201)
  })

  it('register rejects duplicate username', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'securepass', role: 'artist' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await register(req)
    expect(res.status).toBe(409)
  })

  it('register rejects invalid role', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'hacker', password: 'securepass', role: 'admin' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await register(req)
    expect(res.status).toBe(400)
    const data = await res.json()
    expect(data.error).toContain('Invalid role')
  })

  it('register rejects short username', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'ab', password: 'securepass', role: 'artist' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await register(req)
    expect(res.status).toBe(400)
  })

  it('register rejects short password', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'newuser', password: 'short', role: 'artist' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await register(req)
    expect(res.status).toBe(400)
  })

  it('register returns 400 when fields are missing', async () => {
    const req = makeRequest('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username: 'user' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await register(req)
    expect(res.status).toBe(400)
  })

  // ── Me ───────────────────────────────────────────────────────────────

  it('GET /api/auth/me returns user info when authenticated', async () => {
    const token = createTestSession(db, admin.id)
    const req = makeRequest('/api/auth/me', {
      cookies: { fs_session: token },
    })

    const res = await me(req)
    expect(res.status).toBe(200)
    const data = await res.json()
    expect(data.username).toBe('admin')
    expect(data.role).toBe('admin')
  })

  it('GET /api/auth/me returns 401 without session cookie', async () => {
    const req = makeRequest('/api/auth/me')
    const res = await me(req)
    expect(res.status).toBe(401)
  })

  it('GET /api/auth/me returns 401 for invalid session token', async () => {
    const req = makeRequest('/api/auth/me', {
      cookies: { fs_session: 'invalid-token' },
    })
    const res = await me(req)
    expect(res.status).toBe(401)
  })

  // ── Logout ───────────────────────────────────────────────────────────

  it('POST /api/auth/logout clears session cookie', async () => {
    const token = createTestSession(db, admin.id)
    const req = makeRequest('/api/auth/logout', {
      method: 'POST',
      cookies: { fs_session: token },
    })

    const res = await logout(req)
    expect(res.status).toBe(200)
    const setCookie = res.headers.get('set-cookie')
    expect(setCookie).toContain('fs_session')
    expect(setCookie).toContain('Max-Age=0')
  })

  it('POST /api/auth/logout works without a session', async () => {
    const req = makeRequest('/api/auth/logout', { method: 'POST' })
    const res = await logout(req)
    expect(res.status).toBe(200)
  })

  // ── Change Password ──────────────────────────────────────────────────

  it('change-password succeeds with correct current password', async () => {
    const token = createTestSession(db, admin.id)
    const req = makeRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'admin123!!', newPassword: 'newSecure99' }),
      headers: { 'Content-Type': 'application/json' },
      cookies: { fs_session: token },
    })

    const res = await changePassword(req)
    expect(res.status).toBe(200)

    // Verify new password works for login
    const loginReq = makeRequest('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: 'admin', password: 'newSecure99' }),
      headers: { 'Content-Type': 'application/json' },
    })
    const loginRes = await login(loginReq)
    expect(loginRes.status).toBe(200)
  })

  it('change-password fails with wrong current password', async () => {
    const token = createTestSession(db, admin.id)
    const req = makeRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'wrong', newPassword: 'newSecure99' }),
      headers: { 'Content-Type': 'application/json' },
      cookies: { fs_session: token },
    })

    const res = await changePassword(req)
    expect(res.status).toBe(401)
  })

  it('change-password fails with short new password', async () => {
    const token = createTestSession(db, admin.id)
    const req = makeRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'admin123!!', newPassword: 'short' }),
      headers: { 'Content-Type': 'application/json' },
      cookies: { fs_session: token },
    })

    const res = await changePassword(req)
    expect(res.status).toBe(400)
  })

  it('change-password returns 401 without auth', async () => {
    const req = makeRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'admin123!!', newPassword: 'newSecure99' }),
      headers: { 'Content-Type': 'application/json' },
    })

    const res = await changePassword(req)
    expect(res.status).toBe(401)
  })

  it('change-password returns 400 when fields are missing', async () => {
    const token = createTestSession(db, admin.id)
    const req = makeRequest('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ currentPassword: 'admin123!!' }),
      headers: { 'Content-Type': 'application/json' },
      cookies: { fs_session: token },
    })

    const res = await changePassword(req)
    expect(res.status).toBe(400)
  })
})
