/**
 * 预算模块单测：派生 / 执行。
 * 纯逻辑，不依赖模型。
 */
import { describe, expect, it } from 'vitest'
import {
  checkBudget,
  deriveBudget,
  DEFAULT_BUDGET_TABLE,
  EMPTY_USAGE,
  BUDGET_UNLIMITED,
  type BudgetSpec,
  type BudgetUsage,
} from '../l0/budget'

const usage = (over: Partial<BudgetUsage> = {}): BudgetUsage => ({ ...EMPTY_USAGE, ...over })

// ==================== 派生 ====================

describe('deriveBudget', () => {
  it('按 band 取默认值', () => {
    expect(deriveBudget('standard').maxSteps).toBe(512)
    expect(deriveBudget('complex').maxSteps).toBe(1024)
    expect(deriveBudget('complex').modelTier).toBe('strong')
  })

  it('simple 只给 readonly，complex 才给 full', () => {
    expect(deriveBudget('simple').toolsPolicy).toBe('readonly')
    expect(deriveBudget('complex').toolsPolicy).toBe('full')
  })

  it('standard/complex 除步数外暂不设限', () => {
    const s = deriveBudget('standard')
    expect(s.maxToolCalls).toBe(BUDGET_UNLIMITED)
    expect(s.maxInputTokens).toBe(BUDGET_UNLIMITED)
    expect(s.maxOutputTokens).toBe(BUDGET_UNLIMITED)
    expect(s.maxWallClockMs).toBe(BUDGET_UNLIMITED)
    expect(deriveBudget('complex').maxToolCalls).toBe(BUDGET_UNLIMITED)
  })

  it('policy.table 可覆盖单档', () => {
    const spec = deriveBudget('standard', {
      table: { standard: { ...DEFAULT_BUDGET_TABLE.standard, maxSteps: 32 } },
    })
    expect(spec.maxSteps).toBe(32)
  })

  it('policy.override 强制覆盖，未覆盖字段保持', () => {
    const spec = deriveBudget('complex', { override: { maxSteps: 8 } })
    expect(spec.maxSteps).toBe(8)
    expect(spec.modelTier).toBe('strong')
  })

  it('实时派生：策略改动立即生效', () => {
    expect(deriveBudget('standard').maxSteps).not.toBe(
      deriveBudget('standard', { override: { maxSteps: 99 } }).maxSteps,
    )
  })
})

// ==================== 执行 ====================

describe('checkBudget', () => {
  it('未消耗 → ok', () => {
    expect(checkBudget(deriveBudget('standard'), usage()).kind).toBe('ok')
  })

  it('步数耗尽 → ask（桌面端默认停下来问用户）', () => {
    const v = checkBudget(deriveBudget('standard'), usage({ steps: 512 }))
    expect(v.kind).toBe('ask')
    expect(v.kind === 'ask' && v.reason).toBe('超出步数上限')
  })

  it('standard 时限/token/工具次数不限 → 大消耗仍 ok', () => {
    expect(
      checkBudget(
        deriveBudget('standard'),
        usage({
          elapsedMs: 10_000_000,
          outputTokens: 1_000_000,
          inputTokens: 1_000_000,
          toolCalls: 10_000,
          steps: 100,
        }),
      ).kind,
    ).toBe('ok')
  })

  it('trivial 档耗尽 → stop（不打扰用户）', () => {
    const v = checkBudget(deriveBudget('trivial'), usage({ steps: 4 }))
    expect(v.kind).toBe('stop')
  })

  it('回归：maxToolCalls=0 时零消耗不误判为耗尽', () => {
    expect(checkBudget(deriveBudget('trivial'), usage()).kind).toBe('ok')
  })

  it('回归：maxToolCalls=0 时一旦发生调用即越界', () => {
    const v = checkBudget(deriveBudget('trivial'), usage({ toolCalls: 1 }))
    expect(v.kind).not.toBe('ok')
  })

  it('可临时收紧为 stop', () => {
    const spec: BudgetSpec = { ...deriveBudget('standard'), onExhausted: 'stop' }
    expect(checkBudget(spec, usage({ steps: 512 })).kind).toBe('stop')
  })
})
