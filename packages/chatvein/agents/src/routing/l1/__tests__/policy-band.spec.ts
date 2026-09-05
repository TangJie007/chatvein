import { describe, expect, it } from 'vitest'
import { policyForBand } from '../defaults'

describe('policyForBand maxSteps', () => {
  it('uses 8 / 16 / 64 for simple / standard / complex', () => {
    expect(policyForBand('trivial').maxSteps).toBe(0)
    expect(policyForBand('simple').maxSteps).toBe(8)
    expect(policyForBand('standard').maxSteps).toBe(16)
    expect(policyForBand('complex').maxSteps).toBe(64)
    expect(policyForBand('unknown').maxSteps).toBe(16)
  })
})
