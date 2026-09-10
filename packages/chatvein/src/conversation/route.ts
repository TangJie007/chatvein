/**
 * 路由归一化与 lane 选择。
 *
 * `routeFromRouterPlan` 是 Router → 母图的**唯一投影点**（实现方案 §12）：
 * 母图不重造路由语义，只消费 `RouterDecision`。
 */
import { deriveBudget, type BudgetSpec } from '../router/l0/budget'
import type { Band, Domain, Lane } from '../router/types'
import type { ConversationLaneNode, ConversationRoute } from './types'
import { DEFAULT_ROUTE } from './state'

/**
 * RouterDecision 的最小可用形态。
 * 完整类型见 `router/agent.ts`；这里放宽以便 runtime 预填 / 测试直接构造。
 */
export interface RouterPlanLike {
  lane: Lane
  domain: Domain
  band: Band
  budget?: Partial<BudgetSpec>
  query?: Partial<ConversationRoute['query']>
  reason?: string
}

/**
 * 从 RouterDecision 投影为母图 `ConversationRoute`。
 *
 * 预算相关字段一律来自 `budget`（缺失时回落到 `deriveBudget(band)`），
 * 保证 `maxSteps` / `toolsPolicy` 与预算表同源。
 */
export function routeFromRouterPlan(plan: RouterPlanLike): ConversationRoute {
  if (!plan || typeof plan !== 'object') {
    throw new Error('conversation/route.routeFromRouterPlan: plan is required')
  }
  const band: Band = plan.band ?? DEFAULT_ROUTE.band
  const budget = { ...deriveBudget(band), ...plan.budget }
  const rawDomain = String(plan.domain ?? DEFAULT_ROUTE.domain)
  const domain: Domain = rawDomain === 'code' ? 'code' : 'general'

  return {
    lane: plan.lane ?? DEFAULT_ROUTE.lane,
    domain,    band,
    maxSteps: budget.maxSteps,
    toolsPolicy: budget.toolsPolicy,
    query: {
      rewritten: plan.query?.rewritten ?? '',
      ...(plan.query?.searchQuery !== undefined
        ? { searchQuery: plan.query.searchQuery }
        : {}),
      ...(plan.query?.slots !== undefined ? { slots: plan.query.slots } : {}),
      ...(plan.query?.intents !== undefined ? { intents: plan.query.intents } : {}),
    },
    ...(plan.reason !== undefined ? { reason: plan.reason } : {}),
  }
}

/**
 * 归一化 route：`maxSteps` / `toolsPolicy` 缺省时由 **band 的预算表**派生，
 * 保证「只给 lane/domain/band」的调用方也拿到自洽的执行约束（实现方案 §4）。
 */
export function normalizeRoute(partial?: Partial<ConversationRoute>): ConversationRoute {
  const merged = { ...DEFAULT_ROUTE, ...partial }
  const band: Band = merged.band ?? DEFAULT_ROUTE.band
  const budget = deriveBudget(band)
  return {
    ...merged,
    band,
    maxSteps: partial?.maxSteps ?? budget.maxSteps,
    toolsPolicy: partial?.toolsPolicy ?? budget.toolsPolicy,
    query: { ...DEFAULT_ROUTE.query, ...partial?.query },
  }
}

export function selectConversationLane(route: ConversationRoute): ConversationLaneNode {
  return route.lane
}
