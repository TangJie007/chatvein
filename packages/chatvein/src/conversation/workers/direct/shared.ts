/**
 * direct lane 节点公共契约与前置逻辑（reply_only / one_shot 共用）。
 */
import type { BaseMessage } from '@langchain/core/messages'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { withSystemPrompt } from '../../model'
import { DEFAULT_DIRECT_SYSTEM_PROMPT } from './prompt'
import type { ConversationState } from '../../state'
import type { ToolsByDomain, ToolsResolver } from '../../tools'
import type { BudgetPolicy, ConversationHooks } from '../../types'

/** direct 子节点共享工厂选项 */
export interface DirectNodeOptions {
  model?: LanguageModelLike
  systemPrompt?: string
  budgetPolicy?: BudgetPolicy
  signal?: AbortSignal
  hooks?: ConversationHooks
}

export interface DirectLaneOptions extends DirectNodeOptions {
  /** runtime 注入的候选工具池 */
  tools?: StructuredToolInterface[]
  toolsByDomain?: ToolsByDomain
  /** 每轮工具再筛选（内置工具筛选器挂在这里） */
  toolsResolver?: ToolsResolver
}

export function requireDirectModel(
  options: DirectNodeOptions,
  label: string,
): LanguageModelLike {
  if (!options.model) {
    throw new Error(`${label}: options.model is required`)
  }
  return options.model
}

/** 注入 direct persona；已有 system 消息时不重复注入 */
export function directMessages(
  state: Pick<ConversationState, 'messages'>,
  systemPrompt?: string,
): BaseMessage[] {
  return withSystemPrompt(
    state.messages,
    systemPrompt ?? DEFAULT_DIRECT_SYSTEM_PROMPT,
  )
}

/** 进入 direct 子节点时的 hooks + 模型校验 */
export function beginDirectNode(
  options: DirectNodeOptions,
  state: ConversationState,
  nodeName: 'direct:reply_only' | 'direct:one_shot',
): LanguageModelLike {
  options.hooks?.onNode?.(nodeName, state)
  return requireDirectModel(options, `conversation/workers/direct/${nodeName.split(':')[1]}`)
}
