import { randomUUID } from 'node:crypto'
import { Injectable, Logger, ValidationException } from '@electrum/common'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  at: number
}

/**
 * 对话服务（占位实现）。
 *
 * 目前只在内存里维护消息列表并回显，用于打通「渲染端 → IPC → 主进程 → 返回」
 * 的完整链路。接入真实模型时替换 `send` 的实现即可，IPC 契约不变。
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger('ChatService')
  private messages: ChatMessage[] = []

  history(): ChatMessage[] {
    return [...this.messages]
  }

  send(content: string): ChatMessage {
    const text = (content ?? '').trim()
    if (!text) {
      throw new ValidationException('消息内容不能为空', [])
    }

    this.messages.push({
      id: randomUUID(),
      role: 'user',
      content: text,
      at: Date.now(),
    })

    const reply: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: `收到：${text}`,
      at: Date.now(),
    }
    this.messages.push(reply)

    this.logger.log(`chat message accepted (${text.length} chars)`)
    return reply
  }

  clear(): { ok: boolean } {
    this.messages = []
    return { ok: true }
  }
}
