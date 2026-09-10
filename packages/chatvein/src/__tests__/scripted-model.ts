/**
 * 测试用脚本模型：按构造顺序返回预置消息；耗尽后重复最后一条。
 *
 * `bindTools` 返回自身，模拟「支持工具调用」的聊天模型；
 * `calls` 记录每次收到的消息序列，供「模型调用了几次 / 看到了什么」断言。
 */
import { AIMessage, type BaseMessage } from '@langchain/core/messages'
import {
  BaseChatModel,
  type BaseChatModelParams,
} from '@langchain/core/language_models/chat_models'
import type { ChatResult } from '@langchain/core/outputs'
import { contentToString } from '../shared'

export class ScriptedChatModel extends BaseChatModel {
  /** 每次 invoke 收到的消息序列 */
  readonly calls: BaseMessage[][] = []

  private responses: BaseMessage[]
  private cursor = 0

  constructor(responses: BaseMessage[], _fields?: BaseChatModelParams) {
    super({})
    this.responses = responses.length > 0 ? responses : [new AIMessage('')]
  }

  get callCount(): number {
    return this.calls.length
  }

  override bindTools(): this {
    return this
  }

  _llmType(): string {
    return 'scripted'
  }

  async _generate(messages: BaseMessage[]): Promise<ChatResult> {
    this.calls.push(messages)
    const msg = this.responses[Math.min(this.cursor, this.responses.length - 1)]
    this.cursor += 1
    return {
      generations: [
        {
          message: msg,
          text: contentToString(msg.content),
        },
      ],
    }
  }
}

export { AIMessage }
