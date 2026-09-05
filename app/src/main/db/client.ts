/**
 * 主进程 SQLite（node:sqlite）+ drizzle。
 * DB 路径：userData/forge/chat.db
 * conversations + messages（会话历史在库内）。
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
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY NOT NULL,
      conversation_id TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      usage_json TEXT,
      latency_ms INTEGER,
      failed INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
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
