/**
 * direct · reply_only：`toolsPolicy === 'none'` 时的单轮问答。
 *
 * 单次 `model.invoke`，无工具、无循环（实现方案 §6）。
 */
import { invokeModel } from '../../model'
import type { ConversationState, ConversationStateUpdate } from '../../state'
import { beginDirectNode, directMessages, type DirectNodeOptions } from './shared'

export type ReplyOnlyOptions = DirectNodeOptions

export function createReplyOnlyNode(
  options: ReplyOnlyOptions = {},
): (state: ConversationState) => Promise<ConversationStateUpdate> {
  return async function replyOnly(
    state: ConversationState,
  ): Promise<ConversationStateUpdate> {
    const model = beginDirectNode(options, state, 'direct:reply_only')
    const reply = await invokeModel(
      model,
      directMessages(state, options.systemPrompt),
      options.signal,
    )
    return { messages: [reply] }
  }
}
