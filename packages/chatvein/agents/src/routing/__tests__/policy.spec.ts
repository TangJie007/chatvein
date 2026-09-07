import { describe, expect, it } from 'vitest'
import { POLICY_DEFER_TO_L2, POLICY_TRIVIAL_SHORT, policyForBand } from '../policy'

describe('policyForBand', () => {
  it('L2 分档 maxSteps', () => {
    expect(policyForBand('trivial')).toEqual(POLICY_TRIVIAL_SHORT)
    expect(policyForBand('trivial').maxSteps).toBe(4)
    expect(policyForBand('unknown')).toEqual(POLICY_DEFER_TO_L2)
    expect(policyForBand('simple').maxSteps).toBe(8)
    expect(policyForBand('standard').maxSteps).toBe(16)
    expect(policyForBand('complex').maxSteps).toBe(64)
  })
})
