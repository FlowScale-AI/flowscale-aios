import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
import crypto from 'crypto'
import * as schema from './schema'

const DB_DIR = join(homedir(), '.flowscale')
const DB_PATH = join(DB_DIR, 'eios.db')

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (_db) return _db

  mkdirSync(DB_DIR, { recursive: true })

  const sqlite = new Database(DB_PATH)
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('foreign_keys = ON')

  // Init schema
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS tools (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      workflow_json TEXT NOT NULL,
      workflow_hash TEXT NOT NULL,
      schema_json TEXT NOT NULL,
      layout TEXT NOT NULL DEFAULT 'left-right',
      status TEXT NOT NULL DEFAULT 'dev',
      output_dir TEXT,
      comfy_port INTEGER,
      model_version TEXT,
      version INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      deployed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS executions (
      id TEXT PRIMARY KEY,
      tool_id TEXT NOT NULL REFERENCES tools(id) ON DELETE CASCADE,
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

    CREATE INDEX IF NOT EXISTS idx_tools_status ON tools(status);
    CREATE INDEX IF NOT EXISTS idx_executions_tool_id ON executions(tool_id);
    CREATE INDEX IF NOT EXISTS idx_executions_created_at ON executions(created_at DESC);

    CREATE TABLE IF NOT EXISTS canvases (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      viewport_json TEXT NOT NULL DEFAULT '{"x":0,"y":0,"zoom":1}',
      settings_json TEXT NOT NULL DEFAULT '{"grid_size":8,"snap_to_grid":false,"background":"#ffffff"}',
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

    CREATE INDEX IF NOT EXISTS idx_canvas_items_canvas_id ON canvas_items(canvas_id);

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

    CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id);
  `)

  // First-run: seed admin user if no users exist
  const userCount = sqlite.prepare('SELECT COUNT(*) as count FROM users').get() as { count: number }
  if (userCount.count === 0) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
    const bytes = crypto.randomBytes(12)
    let password = ''
    for (let i = 0; i < 12; i++) {
      password += chars[bytes[i] % chars.length]
    }
    const salt = crypto.randomBytes(16).toString('hex')
    const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha512').toString('hex')
    const passwordHash = `${salt}:${hash}`
    const id = crypto.randomUUID()
    const now = Date.now()
    sqlite
      .prepare(
        'INSERT INTO users (id, username, password_hash, role, status, created_at) VALUES (?, ?, ?, ?, ?, ?)',
      )
      .run(id, 'admin', passwordHash, 'admin', 'active', now)
    sqlite.prepare('INSERT OR REPLACE INTO setup (id, initial_password) VALUES (1, ?)').run(password)
  }

  _db = drizzle(sqlite, { schema })
  return _db
}
