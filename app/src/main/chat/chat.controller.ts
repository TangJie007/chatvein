import { Controller, IpcHandle, IpcEmit, Inject } from '@electrum/common'
import { ChatService } from './chat.service'
import type {
  ChatSendInput,
  ChatSendResult,
  ChatStreamEvent,
  Conversation,
} from './chat.types'

@Controller({ prefix: 'chat', window: 'main' })
export class ChatController {
  @Inject(ChatService)
  chat!: ChatService

  /** 主进程 → 渲染进程：推送对话流事件（思考过程等），通道 `chat:event` */
  @IpcEmit('event')
  emitEvent!: (evt: ChatStreamEvent) => void

  @IpcHandle('list')
  list(): Promise<Conversation[]> {
    return this.chat.list()
  }

  @IpcHandle('get')
  get(id: string): Promise<Conversation> {
    return this.chat.get(id)
  }

  @IpcHandle('create')
  create(input?: { title?: string; agentId?: string }): Promise<Conversation> {
    return this.chat.create(input)
  }

  @IpcHandle('remove')
  remove(id: string): Promise<{ ok: true }> {
    return this.chat.remove(id)
  }

  @IpcHandle('send')
  send(input: ChatSendInput): Promise<ChatSendResult> {
    // 每个事件广播给渲染层；渲染层按 conversationId 过滤当前会话
    return this.chat.send(input, (evt) => this.emitEvent(evt))
  }
}
