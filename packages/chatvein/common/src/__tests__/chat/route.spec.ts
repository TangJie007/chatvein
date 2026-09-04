import { describe, expect, it } from 'vitest'
import { parseRouteDecision } from '../../chat/route'

describe('RouteDecision schema', () => {
  it('accepts valid decision', () => {
    const d = parseRouteDecision({
      band: 'standard',
      confident: true,
      policy: {
        modelTier: 'medium',
        tools: 'full',
        maxSteps: 8,
        memoryRecall: true,
      },
      score: 40,
      reasons: ['task_verb'],
      ruleIds: ['task_verb'],
    })
    expect(d.band).toBe('standard')
  })
})
