import { Injectable } from '@electrum/common'
import { asc, desc, eq } from 'drizzle-orm'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import { getChatDb, type ChatDb } from '../../db/client'
import { conversations, messages } from '../../db/schema'
import type { ChatMessage, Conversation, TokenUsage } from '../chat.types'

/**
 * 会话元数据 + 历史消息 → SQLite（userData/forge/chat.db）。
 * 工作区目录只承载脚本/产物，不存聊天记录。
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
    if (conv.messages.length) {
      await this.replaceMessages(conv.id, conv.messages)
    }
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

  async replaceMessages(conversationId: string, list: ChatMessage[]): Promise<void> {
    const db = this.getDb()
    db.delete(messages).where(eq(messages.conversationId, conversationId)).run()
    if (list.length === 0) return
    db.insert(messages)
      .values(
        list.map((m) => ({
          id: m.id,
          conversationId,
          role: m.role,
          content: m.content,
          createdAt: m.createdAt,
          usageJson: m.usage ? JSON.stringify(m.usage) : null,
          latencyMs: m.latencyMs ?? null,
          failed: Boolean(m.failed),
        })),
      )
      .run()
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
    const db = this.getDb()
    const msgs = db
      .select()
      .from(messages)
      .where(eq(messages.conversationId, row.id))
      .orderBy(asc(messages.createdAt))
      .all()
    return {
      id: row.id,
      title: row.title,
      agentId: row.agentId,
      workspacePath: row.workspacePath,
      sandboxPath: row.sandboxPath,
      slug: row.slug,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      messages: msgs.map((m) => ({
        id: m.id,
        role: m.role as ChatMessage['role'],
        content: m.content,
        createdAt: m.createdAt,
        usage: parseUsage(m.usageJson),
        latencyMs: m.latencyMs ?? undefined,
        failed: m.failed ? true : undefined,
      })),
    }
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

function parseUsage(raw: string | null): TokenUsage | undefined {
  if (!raw) return undefined
  try {
    return JSON.parse(raw) as TokenUsage
  } catch {
    return undefined
  }
}
