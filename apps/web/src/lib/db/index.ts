import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync, appendFileSync } from 'fs'
import crypto from 'crypto'
import * as schema from './schema'

const DB_DIR = join(homedir(), '.flowscale')
const DB_PATH = join(DB_DIR, 'aios.db')
const LOG_FILE = join(DB_DIR, 'server-error.log')

function logError(context: string, err: unknown) {
  try {
    const msg = err instanceof Error ? err.stack || err.message : String(err)
    appendFileSync(LOG_FILE, `[${new Date().toISOString()}] ${context}:\n${msg}\n\n`)
  } catch { /* ignore */ }
}

let _db: ReturnType<typeof drizzle<typeof schema>> | null = null

export function getDb() {
  if (_db) return _db

  try {
    mkdirSync(DB_DIR, { recursive: true })
  } catch (err) {
    logError('Failed to create DB_DIR', err)
    throw err
  }

  let sqlite: InstanceType<typeof Database>
  try {
    sqlite = new Database(DB_PATH)
  } catch (err) {
    logError('Failed to open SQLite database', err)
    throw err
  }
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

    CREATE TABLE IF NOT EXISTS installed_apps (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      display_name TEXT NOT NULL,
      bundle_path TEXT NOT NULL,
      entry_path TEXT NOT NULL,
      manifest_json TEXT NOT NULL,
      source TEXT NOT NULL DEFAULT 'sideloaded',
      status TEXT NOT NULL DEFAULT 'active',
      installed_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE TABLE IF NOT EXISTS app_storage (
      app_id TEXT NOT NULL REFERENCES installed_apps(id) ON DELETE CASCADE,
      key TEXT NOT NULL,
      value TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000),
      PRIMARY KEY (app_id, key)
    );

    CREATE INDEX IF NOT EXISTS idx_installed_apps_status ON installed_apps(status);
    CREATE INDEX IF NOT EXISTS idx_app_storage_app_id ON app_storage(app_id);

    CREATE TABLE IF NOT EXISTS models (
      id TEXT PRIMARY KEY,
      filename TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      type TEXT NOT NULL DEFAULT 'other',
      size_bytes INTEGER,
      comfy_port INTEGER NOT NULL,
      scanned_at INTEGER NOT NULL DEFAULT (unixepoch() * 1000)
    );

    CREATE INDEX IF NOT EXISTS idx_models_type ON models(type);
    CREATE INDEX IF NOT EXISTS idx_models_comfy_port ON models(comfy_port);
  `)

  // Migrations for existing DBs
  const toolColumns = sqlite.prepare('PRAGMA table_info(tools)').all() as { name: string }[]
  if (!toolColumns.some((col) => col.name === 'engine')) {
    sqlite.exec("ALTER TABLE tools ADD COLUMN engine TEXT NOT NULL DEFAULT 'comfyui'")
  }

  const canvasColumns = sqlite.prepare('PRAGMA table_info(canvases)').all() as { name: string }[]
  const hasIsSharedColumn = canvasColumns.some((col) => col.name === 'is_shared')
  if (!hasIsSharedColumn) {
    sqlite.exec('ALTER TABLE canvases ADD COLUMN is_shared INTEGER NOT NULL DEFAULT 0')
  }

  const execColumns = sqlite.prepare('PRAGMA table_info(executions)').all() as { name: string }[]
  if (!execColumns.some((col) => col.name === 'user_id')) {
    sqlite.exec('ALTER TABLE executions ADD COLUMN user_id TEXT')
  }

  // Seed built-in API tools (idempotent)
  const Z_IMAGE_ID = 'z-image-turbo-builtin'
  const Z_IMAGE_DESC = 'Generate high-quality images locally using Z-Image Turbo. Runs on your GPU — no API key needed.'
  const zImageExists = sqlite.prepare('SELECT id FROM tools WHERE id = ?').get(Z_IMAGE_ID)
  if (zImageExists) {
    // Keep description up to date
    sqlite.prepare('UPDATE tools SET description = ? WHERE id = ?').run(Z_IMAGE_DESC, Z_IMAGE_ID)
  } else {
    const zImageSchema = JSON.stringify([
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'prompt', paramType: 'string', defaultValue: 'a beautiful landscape', label: 'Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'negative_prompt', paramType: 'string', defaultValue: '', label: 'Negative Prompt', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'width', paramType: 'number', defaultValue: 1024, label: 'Width', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'height', paramType: 'number', defaultValue: 1024, label: 'Height', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'num_inference_steps', paramType: 'number', defaultValue: 4, label: 'Steps', isInput: true, enabled: true },
      { nodeId: 'api', nodeType: 'ZImageTurbo', nodeTitle: 'Z-Image Turbo', paramName: 'guidance_scale', paramType: 'number', defaultValue: 0, label: 'Guidance Scale', isInput: true, enabled: true },
      { nodeId: 'api_output', nodeType: 'APIImageOutput', nodeTitle: 'Output', paramName: 'image', paramType: 'image', isInput: false, enabled: true },
    ])
    const zImageWorkflow = JSON.stringify({ engine: 'api', model: 'Tongyi-MAI/Z-Image-Turbo' })
    const zImageHash = crypto.createHash('sha256').update(zImageWorkflow).digest('hex')
    sqlite.prepare(
      'INSERT INTO tools (id, name, description, engine, workflow_json, workflow_hash, schema_json, layout, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(Z_IMAGE_ID, 'Z-Image Turbo', Z_IMAGE_DESC, 'api', zImageWorkflow, zImageHash, zImageSchema, 'left-right', 'production', Date.now())
  }

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
