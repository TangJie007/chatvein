import { describe, expect, it } from 'vitest'
import { createHeuristicRouter } from '../pipeline'
import { shouldEscalateToL2 } from '../l2'

describe('pipeline HeuristicRouter', () => {
  it('寒暄走 L1 高置信，不依赖 L2', async () => {
    const d = await createHeuristicRouter().route({ text: '你好' })
    expect(d.band).toBe('trivial')
    expect(shouldEscalateToL2(d)).toBe(false)
  })

  it('英文短句灰区可 escalate（无 L2 模型时透传）', async () => {
    const d = await createHeuristicRouter().route({ text: 'hello' })
    expect(d.band).toBe('unknown')
    expect(shouldEscalateToL2(d)).toBe(true)
  })

  it('tools=unknown 也会 escalate 到 L2', async () => {
    const d = await createHeuristicRouter().route({ text: '查询一下今天北京的天气' })
    expect(d.policy.tools).toBe('unknown')
    expect(shouldEscalateToL2(d)).toBe(true)
  })
})
