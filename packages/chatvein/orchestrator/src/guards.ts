import type { Budget, TokenStat } from '@chatvein/common'

/** 护栏判定结果 */
export interface GuardState {
  /** 已用步数（节点转移计数） */
  steps: number
  /** 连续失败次数 */
  consecutiveFailures: number
  /** 运行起始时间戳 */
  startedAt: number
}

export type GuardBreach =
  | { kind: 'tokens'; used: number; limit: number }
  | { kind: 'steps'; used: number; limit: number }
  | { kind: 'wallclock'; usedMs: number; limitMs: number }
  | { kind: 'failures'; used: number; limit: number }

/** 汇总 token 用量 */
export function totalTokens(stat: TokenStat): number {
  return stat.total.totalTokens
}

/**
 * 全局护栏（PRD 5.3.3）：任一触发即熔断。
 * 返回第一个触发的 breach；未触发返回 null。
 */
export function checkBudget(
  budget: Budget,
  tokens: TokenStat,
  guard: GuardState,
): GuardBreach | null {
  const usedTokens = totalTokens(tokens)
  if (usedTokens >= budget.maxTokens) {
    return { kind: 'tokens', used: usedTokens, limit: budget.maxTokens }
  }
  if (guard.steps >= budget.maxSteps) {
    return { kind: 'steps', used: guard.steps, limit: budget.maxSteps }
  }
  const elapsed = Date.now() - guard.startedAt
  if (elapsed >= budget.maxWallClockMs) {
    return { kind: 'wallclock', usedMs: elapsed, limitMs: budget.maxWallClockMs }
  }
  if (guard.consecutiveFailures >= budget.maxConsecutiveFailures) {
    return { kind: 'failures', used: guard.consecutiveFailures, limit: budget.maxConsecutiveFailures }
  }
  return null
}
