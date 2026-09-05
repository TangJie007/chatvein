/**
 * Chat 持久化 schema（drizzle-orm/sqlite-core + node:sqlite）。
 * 仅会话元数据；消息落在会话工作区 messages.json，不进 SQLite。
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

export type ConversationRow = typeof conversations.$inferSelect
