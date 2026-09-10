import { Controller, Inject, IpcHandle } from '@electrum/common'
import { ChatService, type ChatMessage } from './chat.service'

/** 对话域 IPC：`chat:*`。仅做透传与异常包装，逻辑在 ChatService。 */
@Controller('chat')
export class ChatController {
  @Inject(ChatService)
  chatService!: ChatService

  @IpcHandle('send')
  send(content: string): ChatMessage {
    return this.chatService.send(content)
  }

  @IpcHandle('history')
  history(): ChatMessage[] {
    return this.chatService.history()
  }

  @IpcHandle('clear')
  clear(): { ok: boolean } {
    return this.chatService.clear()
  }
}
