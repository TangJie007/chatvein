import { describe, expect, it } from 'vitest'
import { POLICY_DEFER_TO_L2, POLICY_SHORT_CIRCUIT, policyForBand } from '../policy'

describe('policyForBand', () => {
  it('L2 分档 maxSteps', () => {
    expect(policyForBand('trivial')).toEqual(POLICY_SHORT_CIRCUIT)
    expect(policyForBand('unknown')).toEqual(POLICY_DEFER_TO_L2)
    expect(policyForBand('simple').maxSteps).toBe(8)
    expect(policyForBand('standard').maxSteps).toBe(16)
    expect(policyForBand('complex').maxSteps).toBe(64)
  })
})
