import { describe, expect, it } from 'vitest'
import { addTokenUsage, emptyTokenStat, emptyTokenUsage } from './types'

describe('TokenUsage helpers', () => {
  it('addTokenUsage 累加', () => {
    const sum = addTokenUsage(
      { promptTokens: 10, completionTokens: 5, totalTokens: 15 },
      { promptTokens: 3, completionTokens: 7, totalTokens: 10 },
    )
    expect(sum).toEqual({ promptTokens: 13, completionTokens: 12, totalTokens: 25 })
  })

  it('empty 初值', () => {
    expect(emptyTokenUsage().totalTokens).toBe(0)
    expect(emptyTokenStat().byModel).toEqual({})
  })
})
