import { describe, expect, it } from 'vitest'
import { createHeuristicRouter } from '../pipeline'
import { shouldEscalateToL2 } from '../l2'

describe('pipeline HeuristicRouter', () => {
  it('寒暄走 L1 高置信，不依赖 L2', async () => {
    const d = await createHeuristicRouter().route({ text: '你好' })
    expect(d.band).toBe('trivial')
    expect(shouldEscalateToL2(d)).toBe(false)
  })

  it('英文短句 unsupported，可 escalate', async () => {
    const d = await createHeuristicRouter().route({ text: 'hello' })
    expect(d.band).toBe('unknown')
    expect(shouldEscalateToL2(d)).toBe(true)
  })

  it('查询类交 L2', async () => {
    const d = await createHeuristicRouter().route({ text: '查询一下今天北京的天气' })
    expect(d.band).toBe('unknown')
    expect(d.reasons).toContain('defer_to_l2')
    expect(shouldEscalateToL2(d)).toBe(true)
  })
})
