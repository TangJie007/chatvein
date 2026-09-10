import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'

/**
 * 通用键值表。
 *
 * 存储模块的最小起点：承接设置、特性开关等小型单值配置的落盘需求，
 * 不绑定具体业务语义。业务域表（会话、消息等）后续在本目录按域新增。
 */
export const kv = sqliteTable('kv', {
  key: text('key').primaryKey(),
  value: text('value'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})
