import { Injectable } from '@electrum/common'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { app } from 'electron'
import type { ChatStoreFile } from './chat.types'

/**
 * 会话仅保存在主进程内存。不落盘（不做 conversations.json）。
 * 重启 app 后对话列表为空；正式记忆方案另设计，不与聊天记录混用。
 */
@Injectable()
export class ChatStore {
  private cache: ChatStoreFile = { version: 1, conversations: [] }
  private legacyCleared = false

  async load(): Promise<ChatStoreFile> {
    await this.clearLegacyFileOnce()
    return this.cache
  }

  async save(data: ChatStoreFile): Promise<void> {
    this.cache = data
  }

  /** 删除旧版落盘文件，避免残留误导「还有记忆」 */
  private async clearLegacyFileOnce(): Promise<void> {
    if (this.legacyCleared) return
    this.legacyCleared = true
    try {
      const legacy = join(app.getPath('userData'), 'forge', 'conversations.json')
      await fs.unlink(legacy)
      await fs.unlink(`${legacy}.tmp`).catch(() => undefined)
    } catch {
      // 文件不存在或无权删除：忽略
    }
  }
}
