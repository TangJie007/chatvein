/**
 * router 单测：L2 类型契约。
 */
import { describe, expect, it } from 'vitest'
import type { L2Judgement } from '../l2'

describe('router skeleton', () => {
  it('L2Judgement shape accepts lane+domain', () => {
    const j: L2Judgement = {
      lane: 'agentic',
      domain: 'code',
      band: 'standard',
      confidence: 0.9,
      ambiguous: false,
      reason: '单点修 bug',
      rewritten: '修复类型错误',
      searchQuery: 'typescript type error',
    }
    expect(j.lane).toBe('agentic')
    expect(j.domain).toBe('code')
  })
})
