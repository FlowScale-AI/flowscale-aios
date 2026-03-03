import { drizzle } from 'drizzle-orm/better-sqlite3'
import Database from 'better-sqlite3'
import { join } from 'path'
import { homedir } from 'os'
import { mkdirSync } from 'fs'
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
  `)

  _db = drizzle(sqlite, { schema })
  return _db
}
