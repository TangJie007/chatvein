/**
 * agentic lane：按 domain 选 worker（实现方案 §7）。
 *
 * - `general` → `react_chat`：`createChatAgent`（计划 → 逐项执行 → 自检 → 文档）
 * - `code` → `coder_task`：`createDeepAgent` 尚未接线（阶段 B），
 *   **降级**为 general worker 并在 `task.resultSummary` 标注，保证不静默也不抛错。
 *
 * worker 实例按「domain + 本轮工具集合」缓存复用，避免每轮重新编译子图。
 */
import { AIMessage } from '@langchain/core/messages'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { LRUCache } from 'lru-cache'
import type { AnyAgentMiddleware } from 'langchain'
import {
  historyBeforeLastHuman,
  lastHumanMessageText,
} from '../../../shared'
import { createBudgetTracker, budgetExhaustedText } from '../../budget'
import { resolveTools, type ToolsByDomain, type ToolsResolver } from '../../tools'
import { cloneTask, type ConversationState, type ConversationStateUpdate } from '../../state'
import type { BudgetPolicy, ConversationHooks } from '../../types'
import { createChatAgent, type ChatAgent } from '../../workers/general/agent'
import { normalizeWorkerDomain } from './dispatch'

export interface AgenticLaneOptions {
  model?: LanguageModelLike
  /** runtime 注入的候选工具池 */
  tools?: StructuredToolInterface[]
  toolsByDomain?: ToolsByDomain
  /** 每轮工具再筛选（内置工具筛选器挂在这里） */
  toolsResolver?: ToolsResolver
  middleware?: AnyAgentMiddleware[]
  budgetPolicy?: BudgetPolicy
  signal?: AbortSignal
  hooks?: ConversationHooks
  name?: string
}

/** worker 缓存上限（domain × 工具组合，实测组合数很小） */
const WORKER_CACHE_MAX = 16

/**
 * 母图 `agentic` 节点。
 *
 * 节点只做「取 route → 解析工具 → 调 worker 工厂 → 回写 messages / task」，
 * 循环与工具调度全部交给 `createChatAgent` 内部的 LangGraph 子图。
 */
export function createAgenticLane(
  options: AgenticLaneOptions = {},
): (state: ConversationState) => Promise<ConversationStateUpdate> {
  const workers = new LRUCache<string, ChatAgent>({ max: WORKER_CACHE_MAX })

  function workerFor(
    domain: 'general' | 'code',
    tools: StructuredToolInterface[],
  ): ChatAgent {
    if (!options.model) {
      throw new Error('conversation/lanes/agentic: options.model is required')
    }
    const key = `${domain}::${tools.map((t) => t.name).sort().join(',')}`
    const cached = workers.get(key)
    if (cached) return cached
    const agent = createChatAgent({
      model: options.model,
      tools,
      ...(options.name ? { name: `${options.name}:${domain}` } : {}),
      ...(options.middleware ? { middleware: options.middleware } : {}),
    })
    workers.set(key, agent)
    return agent
  }

  return async function agenticLane(
    state: ConversationState,
  ): Promise<ConversationStateUpdate> {
    options.hooks?.onNode?.('agentic', state)

    const domain = normalizeWorkerDomain(state.route?.domain)
    const text = lastHumanMessageText(state.messages ?? [])
    const tracker = createBudgetTracker(state.route.band, options.budgetPolicy)

    const tools = await resolveTools({
      tools: options.tools,
      toolsByDomain: options.toolsByDomain,
      resolver: options.toolsResolver,
      text,
      route: state.route,
      domain,
      toolsPolicy: state.route.toolsPolicy,
    })

    const worker = workerFor(domain, tools)
    const signal = options.signal

    const result = await worker.invoke({
      message: text,
      history: historyBeforeLastHuman(state.messages ?? []),
      recursionLimit: Math.max(8, state.route.maxSteps || 0),
      ...(signal ? { signal } : {}),
    })
    tracker.tick({ steps: 1 })

    const verdict = tracker.probe({ steps: 0 })
    const content =
      verdict.kind === 'ok' ? result.content : `${result.content}\n\n${budgetExhaustedText(verdict)}`
    const degraded =
      domain === 'code'
        ? 'code worker（createDeepAgent）尚未接线，本轮按 general worker 执行'
        : undefined

    return {
      messages: [new AIMessage(content || '（agentic 未产出内容）')],
      task: {
        ...cloneTask(state.task),
        ...(degraded ? { resultSummary: degraded } : { resultSummary: content.slice(0, 500) }),
      },
    }
  }
}
