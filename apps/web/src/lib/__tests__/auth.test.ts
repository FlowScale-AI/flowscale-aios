import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mock the DB module before importing auth
const mockRun = vi.fn()
const mockGet = vi.fn()
const mockInsert = vi.fn(() => ({ values: vi.fn(() => ({ run: mockRun })) }))
const mockDelete = vi.fn(() => ({ where: vi.fn(() => ({ run: mockRun })), run: mockRun }))
const mockSelect = vi.fn(() => ({
  from: vi.fn(() => ({
    innerJoin: vi.fn(() => ({
      where: vi.fn(() => ({
        get: mockGet,
      })),
    })),
  })),
}))

vi.mock('../db', () => ({
  getDb: () => ({
    insert: mockInsert,
    delete: mockDelete,
    select: mockSelect,
  }),
}))

vi.mock('../db/schema', () => ({
  sessions: { id: 'id', userId: 'user_id', expiresAt: 'expires_at' },
  users: { id: 'id' },
  setup: {},
}))

vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a: any, b: any) => ({ op: 'eq', a, b })),
  and: vi.fn((...args: any[]) => ({ op: 'and', args })),
  gt: vi.fn((a: any, b: any) => ({ op: 'gt', a, b })),
}))

import {
  hashPassword,
  verifyPassword,
  hasManagerRole,
  ROLE_NAV,
  createSession,
  getSessionUser,
  deleteSession,
  clearSetupPassword,
  getRequestUser,
} from '../auth'
import type { Role } from '../auth'

// ── hashPassword & verifyPassword ────────────────────────────────────────────

describe('hashPassword', () => {
  it('returns a salt:hash string', () => {
    const result = hashPassword('test123')
    expect(result).toContain(':')
    const parts = result.split(':')
    expect(parts.length).toBe(2)
    expect(parts[0].length).toBe(32) // 16 bytes hex
    expect(parts[1].length).toBe(128) // 64 bytes hex
  })

  it('produces different hashes for the same password (random salt)', () => {
    const a = hashPassword('password')
    const b = hashPassword('password')
    expect(a).not.toBe(b)
  })
})

describe('verifyPassword', () => {
  it('returns true for matching password', () => {
    const stored = hashPassword('mySecret')
    expect(verifyPassword('mySecret', stored)).toBe(true)
  })

  it('returns false for wrong password', () => {
    const stored = hashPassword('mySecret')
    expect(verifyPassword('wrongPassword', stored)).toBe(false)
  })

  it('returns false for malformed stored hash (no colon)', () => {
    expect(verifyPassword('anything', 'noseparator')).toBe(false)
  })

  it('returns false for malformed stored hash (too many colons)', () => {
    expect(verifyPassword('anything', 'a:b:c')).toBe(false)
  })

  it('returns false for empty stored hash', () => {
    expect(verifyPassword('anything', '')).toBe(false)
  })

  it('returns false when stored hash has invalid hex (catches in timingSafeEqual)', () => {
    expect(verifyPassword('test', 'deadbeef00112233deadbeef00112233:zzzz')).toBe(false)
  })

  it('handles empty password input', () => {
    const stored = hashPassword('')
    expect(verifyPassword('', stored)).toBe(true)
    expect(verifyPassword('notempty', stored)).toBe(false)
  })

  it('handles unicode passwords', () => {
    const stored = hashPassword('p@$$w0rd_emoji')
    expect(verifyPassword('p@$$w0rd_emoji', stored)).toBe(true)
  })
})

// ── hasManagerRole ───────────────────────────────────────────────────────────

describe('hasManagerRole', () => {
  it('returns true for admin', () => {
    expect(hasManagerRole('admin')).toBe(true)
  })

  it('returns true for pipeline_td', () => {
    expect(hasManagerRole('pipeline_td')).toBe(true)
  })

  it('returns false for dev', () => {
    expect(hasManagerRole('dev')).toBe(false)
  })

  it('returns false for artist', () => {
    expect(hasManagerRole('artist')).toBe(false)
  })

  it('returns false for unknown role', () => {
    expect(hasManagerRole('unknown')).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(hasManagerRole('')).toBe(false)
  })
})

// ── ROLE_NAV ─────────────────────────────────────────────────────────────────

describe('ROLE_NAV', () => {
  it('defines routes for all four roles', () => {
    const roles: Role[] = ['admin', 'pipeline_td', 'dev', 'artist']
    for (const role of roles) {
      expect(ROLE_NAV[role]).toBeDefined()
      expect(Array.isArray(ROLE_NAV[role])).toBe(true)
      expect(ROLE_NAV[role].length).toBeGreaterThan(0)
    }
  })

  it('admin has access to /users', () => {
    expect(ROLE_NAV.admin).toContain('/users')
  })

  it('pipeline_td has access to /users', () => {
    expect(ROLE_NAV.pipeline_td).toContain('/users')
  })

  it('dev does not have access to /users', () => {
    expect(ROLE_NAV.dev).not.toContain('/users')
  })

  it('artist only has /apps and /canvas', () => {
    expect(ROLE_NAV.artist).toEqual(['/apps', '/canvas'])
  })

  it('admin and pipeline_td have the same routes', () => {
    expect(ROLE_NAV.admin).toEqual(ROLE_NAV.pipeline_td)
  })

  it('all roles have /apps', () => {
    for (const role of Object.keys(ROLE_NAV) as Role[]) {
      expect(ROLE_NAV[role]).toContain('/apps')
    }
  })
})

// ── createSession ────────────────────────────────────────────────────────────

describe('createSession', () => {
  beforeEach(() => {
    mockRun.mockReset()
    mockInsert.mockClear()
  })

  it('returns a 64-char hex token', () => {
    const token = createSession('user-1')
    expect(token).toMatch(/^[0-9a-f]{64}$/)
  })

  it('calls db.insert with session data', () => {
    createSession('user-1')
    expect(mockInsert).toHaveBeenCalled()
  })
})

// ── getSessionUser ───────────────────────────────────────────────────────────

describe('getSessionUser', () => {
  beforeEach(() => {
    mockGet.mockReset()
  })

  it('returns user when session is valid', () => {
    const user = { id: 'u1', username: 'admin', role: 'admin' }
    mockGet.mockReturnValue({ user })
    const result = getSessionUser('valid-token')
    expect(result).toEqual(user)
  })

  it('returns null when no session found', () => {
    mockGet.mockReturnValue(undefined)
    const result = getSessionUser('invalid-token')
    expect(result).toBeNull()
  })

  it('returns null when row has no user', () => {
    mockGet.mockReturnValue({})
    const result = getSessionUser('some-token')
    expect(result).toBeNull()
  })
})

// ── deleteSession ────────────────────────────────────────────────────────────

describe('deleteSession', () => {
  it('calls db.delete', () => {
    mockDelete.mockClear()
    deleteSession('some-token')
    expect(mockDelete).toHaveBeenCalled()
  })
})

// ── clearSetupPassword ───────────────────────────────────────────────────────

describe('clearSetupPassword', () => {
  it('calls db.delete on setup table', () => {
    mockDelete.mockClear()
    clearSetupPassword()
    expect(mockDelete).toHaveBeenCalled()
  })
})

// ── getRequestUser ───────────────────────────────────────────────────────────

describe('getRequestUser', () => {
  it('returns null when no cookie is present', () => {
    const req = {
      cookies: { get: vi.fn().mockReturnValue(undefined) },
    } as any
    const result = getRequestUser(req)
    expect(result).toBeNull()
  })

  it('returns null when cookie value is empty', () => {
    const req = {
      cookies: { get: vi.fn().mockReturnValue({ value: '' }) },
    } as any
    const result = getRequestUser(req)
    expect(result).toBeNull()
  })

  it('returns user when cookie has valid session token', () => {
    const user = { id: 'u1', username: 'admin' }
    mockGet.mockReturnValue({ user })
    const req = {
      cookies: { get: vi.fn().mockReturnValue({ value: 'valid-token' }) },
    } as any
    const result = getRequestUser(req)
    expect(result).toEqual(user)
  })

  it('returns null for expired/invalid session', () => {
    mockGet.mockReturnValue(undefined)
    const req = {
      cookies: { get: vi.fn().mockReturnValue({ value: 'expired-token' }) },
    } as any
    const result = getRequestUser(req)
    expect(result).toBeNull()
  })
})
