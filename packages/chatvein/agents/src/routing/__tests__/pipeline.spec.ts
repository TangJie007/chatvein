import { describe, expect, it } from 'vitest'
import { createHeuristicRouter } from '../pipeline'
import { shouldEscalateToL2 } from '../l2'

describe('pipeline HeuristicRouter', () => {
  it('寒暄走 L1 高置信，不依赖 L2', async () => {
    const d = await createHeuristicRouter().route({ text: '你好' })
    expect(d.band).toBe('trivial')
    expect(shouldEscalateToL2(d)).toBe(false)
  })

  it('英文短句灰区可 escalate（L2 stub 透传）', async () => {
    const d = await createHeuristicRouter().route({ text: 'hello' })
    expect(d.band).toBe('unknown')
    expect(shouldEscalateToL2(d)).toBe(true)
  })
})
