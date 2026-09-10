/**
 * finalize 节点：抽取 finalText。
 *
 * 复用 `shared.extractFinalAssistantText`，不重复实现（实现方案 §16）。
 */
import { extractFinalAssistantText } from '../shared'
import type { ConversationState, ConversationStateUpdate } from './state'
import type { ConversationHooks } from './types'

export interface FinalizeOptions {
  hooks?: ConversationHooks
}

export function createFinalizeNode(
  options: FinalizeOptions = {},
): (state: ConversationState) => Promise<ConversationStateUpdate> {
  return async function finalizeNode(
    state: ConversationState,
  ): Promise<ConversationStateUpdate> {
    options.hooks?.onNode?.('finalize', state)
    return {
      finalText: state.finalText || extractFinalAssistantText(state.messages),
    }
  }
}

export const finalizeNode = createFinalizeNode()
