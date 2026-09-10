/**
 * entry：决定本轮 route（实现方案 §5）。
 *
 * 优先级：lockLane/lockDomain > 预填 route(routeReady) > router.port > 默认 direct·general·trivial
 *
 * router 在图内调用；safety reject / clarification 在此写 finalText，
 * 母图条件边直接进 finalize，不再由 runtime 前置跑一轮路由。
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { lastHumanMessageText } from '../../shared'
import type { RouterDecision, RouterInput } from '../../router/agent'
import { normalizeRoute, routeFromRouterPlan } from '../route'
import {
  DEFAULT_ROUTE,
  type ConversationState,
  type ConversationStateUpdate,
} from '../state'
import type { ConversationHooks, Domain, Lane } from '../types'

export interface EntryNodeOptions {
  lockLane?: Lane
  lockDomain?: Domain
  /** 除 text 外的 RouterInput（history 默认从 messages 推） */
  routerInput?: Omit<RouterInput, 'text'>
  router?: { route(input: RouterInput): Promise<RouterDecision> }
  hooks?: ConversationHooks
}

/** @deprecated 使用 `lastHumanMessageText`（`@chatvein/agents` shared） */
export const lastUserText = lastHumanMessageText

/** 当前用户消息之前的对话，喂给 router（不含本轮） */
function historyBeforeLastHuman(
  messages: ConversationState['messages'],
): Array<{ role: string; content: string }> {
  if (!messages?.length) return []
  let lastHuman = -1
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (HumanMessage.isInstance(messages[i])) {
      lastHuman = i
      break
    }
  }
  const prior = lastHuman >= 0 ? messages.slice(0, lastHuman) : messages
  const out: Array<{ role: string; content: string }> = []
  for (const m of prior) {
    const content = typeof m.content === 'string' ? m.content : ''
    if (!content) continue
    if (HumanMessage.isInstance(m)) out.push({ role: 'user', content })
    else if (AIMessage.isInstance(m)) out.push({ role: 'assistant', content })
  }
  return out
}

export function createEntryNode(
  options: EntryNodeOptions = {},
): (state: ConversationState) => Promise<ConversationStateUpdate> {
  return async function entryNode(
    state: ConversationState,
  ): Promise<ConversationStateUpdate> {
    options.hooks?.onNode?.('entry', state)

    let route = normalizeRoute(state.route)
    let routeReady = state.routeReady === true
    let finalText: string | undefined
    let plan: RouterDecision | undefined

    if (!routeReady) {
      const text = lastHumanMessageText(state.messages ?? [])
      if (options.router) {
        const fromMessages = historyBeforeLastHuman(state.messages ?? [])
        const extra = options.routerInput
        plan = await options.router.route({
          text,
          history: extra?.history ?? (fromMessages.length ? fromMessages : undefined),
          ...(extra?.attachments?.length
            ? { attachments: extra.attachments }
            : {}),
          ...(options.lockLane || extra?.lockLane
            ? { lockLane: options.lockLane ?? extra?.lockLane }
            : {}),
          ...(options.lockDomain || extra?.lockDomain
            ? { lockDomain: options.lockDomain ?? extra?.lockDomain }
            : {}),
          ...(extra?.signal ? { signal: extra.signal } : {}),
        })
        route = routeFromRouterPlan(plan)
        options.hooks?.onRoute?.(plan)

        if (plan.safety?.verdict === 'reject') {
          finalText =
            plan.safety.reason || plan.reason || '请求被安全护栏拒绝'
        } else if (plan.clarification?.question) {
          finalText = plan.clarification.question
        }
      } else {
        route = normalizeRoute({
          ...DEFAULT_ROUTE,
          query: { rewritten: text },
        })
      }
      routeReady = true
    }

    if (options.lockLane || options.lockDomain) {
      route = normalizeRoute({
        ...route,
        ...(options.lockLane ? { lane: options.lockLane } : {}),
        ...(options.lockDomain ? { domain: options.lockDomain } : {}),
      })
      routeReady = true
    }

    return {
      route,
      routeReady,
      ...(finalText !== undefined ? { finalText } : {}),
    }
  }
}

export const entryNode = createEntryNode()
