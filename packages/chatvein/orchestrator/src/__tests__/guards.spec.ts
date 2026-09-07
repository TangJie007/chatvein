import { describe, expect, it } from 'vitest'
import { checkBudget } from '../guards'
import { emptyTokenStat, DEFAULT_BUDGET, type TokenStat } from '@chatvein/common'

function tokens(total: number): TokenStat {
  return {
    byModel: {},
    total: { promptTokens: total, completionTokens: 0, totalTokens: total },
  }
}

describe('checkBudget', () => {
  const guard = { steps: 0, consecutiveFailures: 0, startedAt: Date.now() }

  it('未触顶返回 null', () => {
    expect(checkBudget(DEFAULT_BUDGET, emptyTokenStat(), guard)).toBeNull()
  })

  it('token 超顶触发 tokens 熔断', () => {
    const b = checkBudget({ ...DEFAULT_BUDGET, maxTokens: 100 }, tokens(150), guard)
    expect(b?.kind).toBe('tokens')
  })

  it('步数超顶触发 steps 熔断', () => {
    const b = checkBudget(DEFAULT_BUDGET, emptyTokenStat(), { ...guard, steps: 999 })
    expect(b?.kind).toBe('steps')
  })

  it('连续失败超顶触发 failures 熔断', () => {
    const b = checkBudget(
      DEFAULT_BUDGET,
      emptyTokenStat(),
      { ...guard, consecutiveFailures: 99 },
    )
    expect(b?.kind).toBe('failures')
  })

  it('墙钟超顶触发 wallclock 熔断', () => {
    const b = checkBudget(
      { ...DEFAULT_BUDGET, maxWallClockMs: 1 },
      emptyTokenStat(),
      { ...guard, startedAt: Date.now() - 5000 },
    )
    expect(b?.kind).toBe('wallclock')
  })
})
