import { Controller, IpcHandle, Inject } from '@electrum/common'
import { ChatService } from './chat.service'
import type { ChatSendInput, ChatSendResult, Conversation } from './chat.types'

@Controller('chat')
export class ChatController {
  @Inject(ChatService)
  chat!: ChatService

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
    return this.chat.send(input)
  }
}
