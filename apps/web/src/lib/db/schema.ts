import { sql } from 'drizzle-orm'
import { sqliteTable, text, integer } from 'drizzle-orm/sqlite-core'

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

export type Tool = typeof tools.$inferSelect
export type NewTool = typeof tools.$inferInsert
export type Execution = typeof executions.$inferSelect
export type NewExecution = typeof executions.$inferInsert
