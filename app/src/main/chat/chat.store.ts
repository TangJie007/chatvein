import { Injectable } from '@electrum/common'
import { promises as fs } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { app } from 'electron'
import type { ChatStoreFile, Conversation } from './chat.types'

@Injectable()
export class ChatStore {
  private readonly file: string
  private cache: ChatStoreFile | null = null

  constructor(file?: string) {
    this.file = file ?? join(app.getPath('userData'), 'forge', 'conversations.json')
  }

  async load(): Promise<ChatStoreFile> {
    if (this.cache) return this.cache
    try {
      const raw = await fs.readFile(this.file, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<ChatStoreFile>
      this.cache = {
        version: 1,
        conversations: Array.isArray(parsed.conversations) ? (parsed.conversations as Conversation[]) : [],
      }
    } catch {
      this.cache = { version: 1, conversations: [] }
      await this.persist()
    }
    return this.cache!
  }

  async save(data: ChatStoreFile): Promise<void> {
    this.cache = data
    await this.persist()
  }

  private async persist(): Promise<void> {
    await mkdir(dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    await fs.writeFile(tmp, JSON.stringify(this.cache, null, 2), 'utf-8')
    await fs.rename(tmp, this.file)
  }
}
