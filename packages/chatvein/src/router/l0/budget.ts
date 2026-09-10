/**
 * 预算模块：声明与执行。
 *
 * 场景：**Electron 桌面单用户 agent** —— 有真实的本地文件权限，
 * 但没有多租户、没有网关、没有计费。
 *
 * 真正保留的是「防止 agent 在本地跑飞」：步数 / 工具调用 / token / 时限，以及工具权限档。
 * `checkBudget` 必须由执行图在每一步调用。
 */

import type { Band, ModelTier, ToolsPolicy } from '../types'

export type { Band, ModelTier, ToolsPolicy }

/** 该维不设上限（`checkBudget` 永不因该维触发） */
export const BUDGET_UNLIMITED = Number.POSITIVE_INFINITY

/** 单次请求的预算声明 */
export interface BudgetSpec {
  modelTier: ModelTier
  maxSteps: number
  maxToolCalls: number
  maxInputTokens: number
  maxOutputTokens: number
  maxWallClockMs: number
  toolsPolicy: ToolsPolicy
  /** 耗尽时：stop = 停下；ask = 停下来问用户（桌面端更自然） */
  onExhausted: 'stop' | 'ask'
}

/** 实际消耗 */
export interface BudgetUsage {
  steps: number
  toolCalls: number
  inputTokens: number
  outputTokens: number
  elapsedMs: number
}

/** 每一步检查的结果 */
export type BudgetVerdict =
  | { kind: 'ok' }
  | { kind: 'stop'; reason: string }
  | { kind: 'ask'; reason: string }

/**
 * 默认预算表。
 *
 * - `simple` 给 `readonly` 而非 `full`：短查询不该有写 / 删 / 外发权限。
 * - `standard` / `complex`：桌面解题优先，暂时只硬卡步数，其余维度不限。
 */
export const DEFAULT_BUDGET_TABLE: Record<Band, BudgetSpec> = {
  trivial: {
    modelTier: 'weak',
    maxSteps: 4,
    maxToolCalls: 0,
    maxInputTokens: 16_000,
    maxOutputTokens: 2_000,
    maxWallClockMs: 20_000,
    toolsPolicy: 'none',
    onExhausted: 'stop',
  },
  simple: {
    modelTier: 'weak',
    maxSteps: 12,
    maxToolCalls: 6,
    maxInputTokens: 32_000,
    maxOutputTokens: 4_000,
    maxWallClockMs: 60_000,
    toolsPolicy: 'readonly',
    onExhausted: 'ask',
  },
  standard: {
    modelTier: 'medium',
    maxSteps: 512,
    maxToolCalls: BUDGET_UNLIMITED,
    maxInputTokens: BUDGET_UNLIMITED,
    maxOutputTokens: BUDGET_UNLIMITED,
    maxWallClockMs: BUDGET_UNLIMITED,
    toolsPolicy: 'full',
    onExhausted: 'ask',
  },
  complex: {
    modelTier: 'strong',
    maxSteps: 1024,
    maxToolCalls: BUDGET_UNLIMITED,
    maxInputTokens: BUDGET_UNLIMITED,
    maxOutputTokens: BUDGET_UNLIMITED,
    maxWallClockMs: BUDGET_UNLIMITED,
    toolsPolicy: 'full',
    onExhausted: 'ask',
  },
}

export const EMPTY_USAGE: BudgetUsage = {
  steps: 0,
  toolCalls: 0,
  inputTokens: 0,
  outputTokens: 0,
  elapsedMs: 0,
}

export interface BudgetPolicy {
  table?: Partial<Record<Band, BudgetSpec>>
  override?: Partial<BudgetSpec>
}

/** 由 band 派生预算。每次路由实时调用，不进缓存。 */
export function deriveBudget(band: Band, policy: BudgetPolicy = {}): BudgetSpec {
  const table = { ...DEFAULT_BUDGET_TABLE, ...policy.table }
  const base = table[band]
  return policy.override ? { ...base, ...policy.override } : base
}

/** `max` 非有限 → 不限；`max <= 0` → 零配额（有消耗即越界） */
const exceeds = (used: number, max: number): boolean => {
  if (!Number.isFinite(max)) return false
  return max <= 0 ? used > 0 : used >= max
}

function exhaustReason(spec: BudgetSpec, used: BudgetUsage): string | undefined {
  if (exceeds(used.elapsedMs, spec.maxWallClockMs)) return '超出时限'
  if (exceeds(used.steps, spec.maxSteps)) return '超出步数上限'
  if (exceeds(used.toolCalls, spec.maxToolCalls)) return '超出工具调用上限'
  if (exceeds(used.outputTokens, spec.maxOutputTokens)) return '超出输出 token 上限'
  if (exceeds(used.inputTokens, spec.maxInputTokens)) return '超出输入 token 上限'
  return undefined
}

export function checkBudget(spec: BudgetSpec, used: BudgetUsage): BudgetVerdict {
  const reason = exhaustReason(spec, used)
  if (!reason) return { kind: 'ok' }
  return spec.onExhausted === 'ask' ? { kind: 'ask', reason } : { kind: 'stop', reason }
}
