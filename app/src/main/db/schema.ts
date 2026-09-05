/**
 * Chat 持久化 schema（drizzle-orm/sqlite-core + node:sqlite）。
 * conversations = 会话元数据；messages = 会话历史。
 * 工作区目录只放脚本/产物（scripts、runs），不存聊天记录。
 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(),
  title: text('title').notNull(),
  agentId: text('agent_id').notNull(),
  /** 配置 workspaceRoot 下的时间戳会话目录 */
  workspacePath: text('workspace_path').notNull(),
  /** 会话目录下 runs/（sandboxPath = workspacePath/runs） */
  sandboxPath: text('sandbox_path').notNull(),
  /** 目录名 slug，如 20260906-001209-a1b2c3d4 */
  slug: text('slug').notNull(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(),
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(),
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }),
  role: text('role').notNull(),
  content: text('content').notNull(),
  createdAt: integer('created_at', { mode: 'number' }).notNull(),
  /** JSON：TokenUsage */
  usageJson: text('usage_json'),
  latencyMs: integer('latency_ms', { mode: 'number' }),
  failed: integer('failed', { mode: 'boolean' }).notNull().default(false),
})

export type ConversationRow = typeof conversations.$inferSelect
export type MessageRow = typeof messages.$inferSelect
