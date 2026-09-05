/**
 * 主进程 SQLite（node:sqlite）+ drizzle。
 * DB 路径：userData/forge/chat.db
 * 仅 conversations；消息在会话工作区文件，不进库。
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'
import { app } from 'electron'

export type ChatDb = ReturnType<typeof createChatDb>

let singleton: ChatDb | null = null
let sqliteClient: DatabaseSync | null = null

export function getChatDbPath(): string {
  return join(app.getPath('userData'), 'forge', 'chat.db')
}

export function createChatDb(dbPath = getChatDbPath()) {
  mkdirSync(dirname(dbPath), { recursive: true })
  const client = new DatabaseSync(dbPath)
  client.exec('PRAGMA foreign_keys = ON;')
  // 历史库可能有 messages 表，启动时丢掉
  client.exec('DROP TABLE IF EXISTS messages;')
  client.exec(`
    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY NOT NULL,
      title TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      sandbox_path TEXT NOT NULL,
      slug TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conversations_updated_at ON conversations(updated_at);
  `)
  sqliteClient = client
  return drizzle({ client })
}

export function getChatDb(): ChatDb {
  if (!singleton) singleton = createChatDb()
  return singleton
}

/** 测试/热重载用 */
export function closeChatDb(): void {
  try {
    sqliteClient?.close()
  } catch {
    // ignore
  }
  sqliteClient = null
  singleton = null
}
