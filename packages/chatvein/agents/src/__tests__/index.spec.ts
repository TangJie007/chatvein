import { describe, expect, it } from 'vitest'
import { CHATVEIN_AGENTS_VERSION } from '../index'

describe('@chatvein/agents', () => {
  it('exports version', () => {
    expect(CHATVEIN_AGENTS_VERSION).toBe('0.1.0')
  })
})
