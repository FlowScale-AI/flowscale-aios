import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer, primaryKey } from 'drizzle-orm/sqlite-core'

export const tools = sqliteTable('tools', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description'),
  workflowJson: text('workflow_json').notNull(),
  workflowHash: text('workflow_hash').notNull(),
  schemaJson: text('schema_json').notNull(), // WorkflowIO[] serialized
  layout: text('layout').notNull().default('left-right'),
  status: text('status').notNull().default('dev'), // 'dev' | 'production'
  outputDir: text('output_dir'),
  comfyPort: integer('comfy_port'), // port of detected ComfyUI chosen at deploy/test time
  modelVersion: text('model_version'),
  version: integer('version').notNull().default(1),
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  deployedAt: integer('deployed_at'),
})

export const executions = sqliteTable('executions', {
  id: text('id').primaryKey(),
  toolId: text('tool_id').notNull().references(() => tools.id, { onDelete: 'cascade' }),
  inputsJson: text('inputs_json').notNull(),
  outputsJson: text('outputs_json'), // null until complete
  seed: integer('seed'),
  promptId: text('prompt_id'),
  workflowHash: text('workflow_hash').notNull(),
  status: text('status').notNull().default('running'), // 'running' | 'completed' | 'error'
  errorMessage: text('error_message'),
  metadataJson: text('metadata_json'), // timing, model_version, etc.
  createdAt: integer('created_at').notNull().default(sql`(unixepoch() * 1000)`),
  completedAt: integer('completed_at'),
})

export const canvases = sqliteTable('canvases', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  description: text('description').notNull().default(''),
  viewportJson: text('viewport_json').notNull().default('{"x":0,"y":0,"zoom":1}'),
  settingsJson: text('settings_json').notNull().default('{"grid_size":8,"snap_to_grid":false,"background":"#ffffff"}'),
  createdAt: text('created_at').notNull(),
  updatedAt: text('updated_at').notNull(),
})

export const canvasItems = sqliteTable('canvas_items', {
  id: text('id').notNull(),
  canvasId: text('canvas_id').notNull().references(() => canvases.id, { onDelete: 'cascade' }),
  type: text('type').notNull(),
  positionJson: text('position_json').notNull(),
  zIndex: integer('z_index').notNull().default(0),
  locked: integer('locked').notNull().default(0),
  hidden: integer('hidden').notNull().default(0),
  dataJson: text('data_json'),
  propertiesJson: text('properties_json'),
}, (t) => [primaryKey({ columns: [t.canvasId, t.id] })])

export const toolConfigs = sqliteTable('tool_configs', {
  workflowId: text('workflow_id').primaryKey(),
  configJson: text('config_json').notNull(),
})

export type Tool = typeof tools.$inferSelect
export type NewTool = typeof tools.$inferInsert
export type Execution = typeof executions.$inferSelect
export type NewExecution = typeof executions.$inferInsert
export type Canvas = typeof canvases.$inferSelect
export type CanvasItemRow = typeof canvasItems.$inferSelect
