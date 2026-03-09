import crypto from 'crypto'
import { eq, and, gt } from 'drizzle-orm'
import { getDb } from './db'
import { sessions, users, setup } from './db/schema'
import type { User } from './db/schema'
import type { NextRequest } from 'next/server'

export type Role = 'admin' | 'pipeline_td' | 'dev' | 'artist'

export const ROLE_NAV: Record<Role, string[]> = {
  admin: ['/home', '/tools', '/providers', '/explore', '/canvas', '/settings', '/users', '/models', '/outputs', '/integrations', '/apps', '/build-tool'],
  pipeline_td: ['/home', '/tools', '/providers', '/explore', '/canvas', '/settings', '/users', '/models', '/outputs', '/integrations', '/apps', '/build-tool'],
  dev: ['/home', '/tools', '/providers', '/explore', '/canvas', '/settings', '/models', '/outputs', '/integrations', '/apps', '/build-tool'],
  artist: ['/home', '/canvas', '/explore', '/outputs', '/apps'],
}

export function hasManagerRole(role: string): boolean {
  return role === 'admin' || role === 'pipeline_td'
}

export function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return `${salt}:${hash}`
}

export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split(':')
  if (parts.length !== 2) return false
  const [salt, storedHash] = parts
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(storedHash, 'hex'))
  } catch {
    return false
  }
}

export function createSession(userId: string): string {
  const db = getDb()
  const token = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000
  db.insert(sessions).values({ id: token, userId, expiresAt, createdAt: now }).run()
  return token
}

export function getSessionUser(token: string): User | null {
  const db = getDb()
  const now = Date.now()
  const row = db
    .select({ user: users })
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(and(eq(sessions.id, token), gt(sessions.expiresAt, now)))
    .get()
  return row?.user ?? null
}

export function deleteSession(token: string): void {
  const db = getDb()
  db.delete(sessions).where(eq(sessions.id, token)).run()
}

export function clearSetupPassword(): void {
  const db = getDb()
  db.delete(setup).run()
}

export function getRequestUser(req: NextRequest): User | null {
  const token = req.cookies.get('fs_session')?.value
  if (!token) return null
  return getSessionUser(token)
}
