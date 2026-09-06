import { Controller, IpcHandle, IpcEmit, Inject } from '@electrum/common'
import { ChatService } from './chat.service'
import type {
  ChatRetryInput,
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

  @IpcHandle('retry')
  retry(input: ChatRetryInput): Promise<ChatSendResult> {
    return this.chat.retry(input, (evt) => this.emitEvent(evt))
  }

  /** 会话工作区现有文件（供产物面板回填） */
  @IpcHandle('listArtifacts')
  listArtifacts(conversationId: string) {
    return this.chat.listArtifacts(conversationId)
  }

  /** 删除产物文件（须在会话 workspace 内；二次确认在渲染层） */
  @IpcHandle('removeArtifact')
  removeArtifact(data: { conversationId: string; absPath: string }) {
    return this.chat.removeArtifact(data.conversationId, data.absPath)
  }

  /** 读取助手消息对应的思考流日志 */
  @IpcHandle('getThinkingLog')
  getThinkingLog(data: { conversationId: string; messageId: string }) {
    return this.chat.getThinkingLog(data.conversationId, data.messageId)
  }
}
