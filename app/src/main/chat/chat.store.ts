import { Injectable } from '@electrum/common'
import { desc, eq } from 'drizzle-orm'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getChatDb, type ChatDb } from '../db/client'
import { conversations } from '../db/schema'
import type { ChatMessage, Conversation } from './chat.types'

const MESSAGES_FILE = 'messages.json'

/**
 * 会话元数据 → SQLite；消息 → 会话工作区 messages.json。
 */
@Injectable()
export class ChatStore {
  private db: ChatDb | null = null
  private legacyCleared = false

  private getDb(): ChatDb {
    if (!this.db) this.db = getChatDb()
    return this.db
  }

  async list(): Promise<Conversation[]> {
    await this.clearLegacyFileOnce()
    const db = this.getDb()
    const rows = db.select().from(conversations).orderBy(desc(conversations.updatedAt)).all()
    const out: Conversation[] = []
    for (const row of rows) {
      out.push(await this.hydrate(row))
    }
    return out
  }

  async get(id: string): Promise<Conversation | null> {
    await this.clearLegacyFileOnce()
    const db = this.getDb()
    const row = db.select().from(conversations).where(eq(conversations.id, id)).get()
    if (!row) return null
    return this.hydrate(row)
  }

  async insert(conv: Conversation): Promise<Conversation> {
    const db = this.getDb()
    db.insert(conversations)
      .values({
        id: conv.id,
        title: conv.title,
        agentId: conv.agentId,
        workspacePath: conv.workspacePath,
        sandboxPath: conv.sandboxPath,
        slug: conv.slug,
        createdAt: conv.createdAt,
        updatedAt: conv.updatedAt,
      })
      .run()
    await this.writeMessages(conv.workspacePath, conv.messages)
    return conv
  }

  async updateMeta(
    id: string,
    patch: Partial<Pick<Conversation, 'title' | 'agentId' | 'updatedAt'>>,
  ): Promise<void> {
    const db = this.getDb()
    const next: Record<string, unknown> = {}
    if (patch.title !== undefined) next.title = patch.title
    if (patch.agentId !== undefined) next.agentId = patch.agentId
    if (patch.updatedAt !== undefined) next.updatedAt = patch.updatedAt
    if (Object.keys(next).length === 0) return
    db.update(conversations).set(next).where(eq(conversations.id, id)).run()
  }

  /** 消息写入会话工作区，不进 SQLite */
  async replaceMessages(workspacePath: string, list: ChatMessage[]): Promise<void> {
    await this.writeMessages(workspacePath, list)
  }

  async remove(id: string): Promise<Conversation | null> {
    const existing = await this.get(id)
    if (!existing) return null
    const db = this.getDb()
    db.delete(conversations).where(eq(conversations.id, id)).run()
    return existing
  }

  private async hydrate(row: {
    id: string
    title: string
    agentId: string
    workspacePath: string
    sandboxPath: string
    slug: string
    createdAt: number
    updatedAt: number
  }): Promise<Conversation> {
    return {
      id: row.id,
      title: row.title,
      agentId: row.agentId,
      workspacePath: row.workspacePath,
      sandboxPath: row.sandboxPath,
      slug: row.slug,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messages: await this.readMessages(row.workspacePath),
    }
  }

  private messagesPath(workspacePath: string): string {
    return join(workspacePath, MESSAGES_FILE)
  }

  private async readMessages(workspacePath: string): Promise<ChatMessage[]> {
    try {
      const raw = await fs.readFile(this.messagesPath(workspacePath), 'utf8')
      const parsed = JSON.parse(raw) as unknown
      if (!Array.isArray(parsed)) return []
      return parsed as ChatMessage[]
    } catch {
      return []
    }
  }

  private async writeMessages(workspacePath: string, list: ChatMessage[]): Promise<void> {
    await fs.mkdir(workspacePath, { recursive: true })
    const path = this.messagesPath(workspacePath)
    const tmp = `${path}.tmp`
    await fs.writeFile(tmp, JSON.stringify(list, null, 2), 'utf8')
    await fs.rename(tmp, path)
  }

  private async clearLegacyFileOnce(): Promise<void> {
    if (this.legacyCleared) return
    this.legacyCleared = true
    try {
      const legacy = join(app.getPath('userData'), 'forge', 'conversations.json')
      await fs.unlink(legacy)
      await fs.unlink(`${legacy}.tmp`).catch(() => undefined)
    } catch {
      // ignore
    }
  }
}
