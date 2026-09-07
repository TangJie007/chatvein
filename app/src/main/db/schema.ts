/**
 * Chat 持久化 schema（drizzle-orm/sqlite-core + node:sqlite）。
 * conversations = 会话元数据；messages = 会话历史。
 * 工作区目录只放脚本/产物（scripts、runs），不存聊天记录。
 */
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

export const conversations = sqliteTable('conversations', {
  id: text('id').primaryKey(), // 会话主键
  title: text('title').notNull(), // 会话标题（默认取首条用户消息截断）
  agentId: text('agent_id').notNull(), // 绑定的 Agent id
  workspacePath: text('workspace_path').notNull(), // settings.workspaceRoot / {slug}
  sandboxPath: text('sandbox_path').notNull(), // workspacePath / runs
  slug: text('slug').notNull(), // 目录名，如 20260906-001209-a1b2c3d4
  /** 会话锁定工作模式：office | code | custom；空=尚未聊天可切换 */
  workMode: text('work_mode'),
  createdAt: integer('created_at', { mode: 'number' }).notNull(), // Unix ms
  updatedAt: integer('updated_at', { mode: 'number' }).notNull(), // Unix ms
})

export const messages = sqliteTable('messages', {
  id: text('id').primaryKey(), // 消息主键
  conversationId: text('conversation_id')
    .notNull()
    .references(() => conversations.id, { onDelete: 'cascade' }), // 所属会话；级联删除
  role: text('role').notNull(), // user | assistant | system
  content: text('content').notNull(), // 消息正文
  createdAt: integer('created_at', { mode: 'number' }).notNull(), // Unix ms
  usageJson: text('usage_json'), // JSON：TokenUsage（仅 assistant）
  latencyMs: integer('latency_ms', { mode: 'number' }), // 生成耗时 ms（仅 assistant）
  failed: integer('failed', { mode: 'boolean' }).notNull().default(false), // 失败占位，可重试
  /** JSON：ChatAttachment[]（用户消息附件，如赛事需求文档路径） */
  attachmentsJson: text('attachments_json'),
})

export type ConversationRow = typeof conversations.$inferSelect
export type MessageRow = typeof messages.$inferSelect
