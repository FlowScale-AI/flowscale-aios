/**
 * Integration test helper: creates an in-memory SQLite DB with the same schema
 * as production, and mocks `@/lib/db` so all route handlers use it.
 */
import { vi } from 'vitest'
import crypto from 'crypto'
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import * as schema from '../../lib/db/schema'
import { NextRequest } from 'next/server'

const DDL = `
  CREATE TABLE IF NOT EXISTS tools (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    engine TEXT NOT NULL DEFAULT 'comfyui',
    workflow_json TEXT NOT NULL,
    workflow_hash TEXT NOT NULL,
    schema_json TEXT NOT NULL,
    layout TEXT NOT NULL DEFAULT 'left-right',
    status TEXT NOT NULL DEFAULT 'dev',
    source TEXT NOT NULL DEFAULT 'comfyui',
    output_dir TEXT,
    comfy_port INTEGER,
    model_version TEXT,
    source_url TEXT,
    version INTEGER NOT NULL DEFAULT 1,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    deployed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS executions (
    id TEXT PRIMARY KEY,
    tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
    user_id TEXT REFERENCES users(id) ON DELETE SET NULL,
    inputs_json TEXT NOT NULL,
    outputs_json TEXT,
    seed INTEGER,
    prompt_id TEXT,
    workflow_hash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'running',
    error_message TEXT,
    metadata_json TEXT,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    completed_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS canvases (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    viewport_json TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
    settings_json TEXT NOT NULL DEFAULT '{"grid_size":8,"snap_to_grid":false,"background":"#ffffff"}',
    is_shared INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS canvas_items (
    id TEXT NOT NULL,
    canvas_id TEXT NOT NULL REFERENCES canvases(id) ON DELETE CASCADE,
    type TEXT NOT NULL,
    position_json TEXT NOT NULL,
    z_index INTEGER NOT NULL DEFAULT 0,
    locked INTEGER NOT NULL DEFAULT 0,
    hidden INTEGER NOT NULL DEFAULT 0,
    data_json TEXT,
    properties_json TEXT,
    PRIMARY KEY (canvas_id, id)
  );

  CREATE TABLE IF NOT EXISTS tool_configs (
    workflow_id TEXT PRIMARY KEY,
    config_json TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'artist',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
    approved_at INTEGER,
    approved_by TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
  );

  CREATE TABLE IF NOT EXISTS setup (
    id INTEGER PRIMARY KEY DEFAULT 1,
    initial_password TEXT NOT NULL
  );
`

export function createTestDb() {
  const sqlite = new Database(':memory:')
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')
  sqlite.exec(DDL)
  return drizzle(sqlite, { schema })
}

export type TestDb = ReturnType<typeof createTestDb>

/** Hash a password using the same algorithm as lib/auth (inlined to avoid import issues with mocked db). */
function hashPassword(password: string): string {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
  return `${salt}:${hash}`
}

/** Seed an active admin user and return their data. */
export function seedAdmin(db: TestDb) {
  const id = 'admin-test-id'
  const passwordHash = hashPassword('admin123!!')
  db.insert(schema.users)
    .values({ id, username: 'admin', passwordHash, role: 'admin', status: 'active', createdAt: Date.now() })
    .run()
  return { id, username: 'admin', password: 'admin123!!', role: 'admin' }
}

/** Create a session token for a user and return it. */
export function createTestSession(db: TestDb, userId: string) {
  const token = crypto.randomBytes(32).toString('hex')
  const now = Date.now()
  const expiresAt = now + 7 * 24 * 60 * 60 * 1000
  db.insert(schema.sessions).values({ id: token, userId, expiresAt, createdAt: now }).run()
  return token
}

/** Build a NextRequest-compatible object for route handler testing. */
export function makeRequest(
  url: string,
  init?: RequestInit & { cookies?: Record<string, string> },
) {
  const { signal, ...restInit } = init ?? {}
  const req = new NextRequest(new URL(url, 'http://localhost'), {
    ...restInit,
    ...(signal != null ? { signal } : {}),
  })
  if (init?.cookies) {
    for (const [name, value] of Object.entries(init.cookies)) {
      req.cookies.set(name, value)
    }
  }
  return req
}
