/**
 * 预算执行点（实现方案 §10）。
 *
 * 对齐 Router 设计：**没有执行点的预算维度等于幻觉。**
 * `BudgetSpec` 与 `BudgetUsage` 都不进 Annotation —— 由工厂闭包 / 节点内持有，
 * 每步调用 `checkBudget` 才能真正生效。
 */
import {
  checkBudget,
  deriveBudget,
  EMPTY_USAGE,
  type BudgetPolicy,
  type BudgetSpec,
  type BudgetUsage,
  type BudgetVerdict,
} from '../router/l0/budget'
import type { Band } from './types'

export type { BudgetPolicy, BudgetSpec, BudgetUsage, BudgetVerdict }

/** 一轮（单次 invoke）内的预算账本 */
export interface BudgetTracker {
  /** 本轮预算声明（由 band 派生） */
  readonly spec: BudgetSpec
  /** 本轮累计消耗（可变，仅供读取） */
  readonly usage: BudgetUsage
  /** 累加消耗后校验：模型调用 / 工具调用后调用 */
  tick(delta?: Partial<BudgetUsage>): BudgetVerdict
  /** 预演校验：不落账，用于「这一步会不会超」 */
  probe(delta: Partial<BudgetUsage>): BudgetVerdict
  /** 当前快照（含 elapsedMs） */
  snapshot(): { spec: BudgetSpec; usage: BudgetUsage }
}

/**
 * 创建一轮预算账本。`elapsedMs` 相对创建时刻自动累计。
 */
export function createBudgetTracker(band: Band, policy?: BudgetPolicy): BudgetTracker {
  const spec = deriveBudget(band, policy)
  const startedAt = Date.now()
  const usage: BudgetUsage = { ...EMPTY_USAGE }

  const elapsed = (): BudgetUsage => {
    usage.elapsedMs = Math.max(0, Date.now() - startedAt)
    return usage
  }

  return {
    spec,
    usage,
    tick(delta: Partial<BudgetUsage> = {}): BudgetVerdict {
      usage.steps += delta.steps ?? 0
      usage.toolCalls += delta.toolCalls ?? 0
      usage.inputTokens += delta.inputTokens ?? 0
      usage.outputTokens += delta.outputTokens ?? 0
      return checkBudget(spec, elapsed())
    },
    probe(delta: Partial<BudgetUsage>): BudgetVerdict {
      return checkBudget(spec, {
        ...elapsed(),
        steps: usage.steps + (delta.steps ?? 0),
        toolCalls: usage.toolCalls + (delta.toolCalls ?? 0),
        inputTokens: usage.inputTokens + (delta.inputTokens ?? 0),
        outputTokens: usage.outputTokens + (delta.outputTokens ?? 0),
      })
    },
    snapshot() {
      return { spec, usage: { ...elapsed() } }
    },
  }
}

/** 预算触顶时给用户的明确提示（direct 档：不再继续，直接 finalize） */
export function budgetExhaustedText(verdict: BudgetVerdict): string {
  const reason = verdict.kind === 'ok' ? '' : verdict.reason
  return `（已触发本轮预算上限${reason ? `：${reason}` : ''}，停止继续调用）`
}
