/**
 * 母图 Annotation 状态通道。
 *
 * channels: messages | route | routeReady | task | finalText
 *
 * 约定（实现方案 §4）：
 * - `tools` / 完整 `BudgetSpec` / `BudgetUsage` **不进 state**：由工厂闭包持有，
 *   避免策略变更被旧 checkpoint 绑死。
 * - `route` 必有默认值，无法表达「未路由」——用 `routeReady` 区分。
 * @see docs/conversation-graph-implementation.md §4
 */
import type { BaseMessage } from '@langchain/core/messages'
import { Annotation, messagesStateReducer } from '@langchain/langgraph'
import { deriveBudget } from '../router/l0/budget'
import type { ConversationRoute, TaskState } from './types'

/**
 * 默认档与预算表同源（`deriveBudget('trivial')`），禁止手抄数字。
 * 实现方案 §4 正文里的 `maxSteps: 1` 与预算表（trivial → 4）不一致，以预算表为准。
 */
const TRIVIAL_BUDGET = deriveBudget('trivial')

export const DEFAULT_ROUTE: ConversationRoute = {
  lane: 'direct',
  domain: 'general',
  band: 'trivial',
  maxSteps: TRIVIAL_BUDGET.maxSteps,
  toolsPolicy: TRIVIAL_BUDGET.toolsPolicy,
  query: { rewritten: '' },
}

export const DEFAULT_TASK: TaskState = {
  artifacts: [],
  plan: [],
  repairCount: 0,
}

/** @deprecated 使用 DEFAULT_TASK */
export const DEFAULT_OFFICE = DEFAULT_TASK

export function cloneRoute(route: ConversationRoute = DEFAULT_ROUTE): ConversationRoute {
  return {
    ...route,
    query: { ...(route.query ?? DEFAULT_ROUTE.query) },
  }
}

export function cloneTask(task: TaskState = DEFAULT_TASK): TaskState {
  return {
    ...task,
    artifacts: [...(task.artifacts ?? [])],
    plan: [...(task.plan ?? [])],
  }
}

/**
 * 母图状态。
 *
 * - `messages`：`messagesStateReducer`（按 id 追加 / 覆盖）；worker 整表替换时用 `Overwrite`。
 * - `route`：每次写入整表替换（节点先 `normalizeRoute` 再写）。
 * - `routeReady`：仅「调用方显式预填」或「entry 写完」后为 true。
 * - `finalText`：finalize 写入，同时作为 invoke 返回值投影（实现方案 §15）。
 */
export const ConversationStateAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  route: Annotation<ConversationRoute>({
    reducer: (_prev, next) => next ?? DEFAULT_ROUTE,
    default: () => cloneRoute(),
  }),
  routeReady: Annotation<boolean>({
    reducer: (_prev, next) => next ?? false,
    default: () => false,
  }),
  task: Annotation<TaskState>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => cloneTask(),
  }),
  finalText: Annotation<string>({
    reducer: (_prev, next) => next ?? '',
    default: () => '',
  }),
})

export type ConversationState = typeof ConversationStateAnnotation.State
export type ConversationStateUpdate = typeof ConversationStateAnnotation.Update
