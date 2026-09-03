import { describe, expect, it } from 'vitest'
import { CHATVEIN_GROUPS_VERSION } from '../index'

describe('@chatvein/groups', () => {
  it('exports version', () => {
    expect(CHATVEIN_GROUPS_VERSION).toBe('0.1.0')
  })
})
