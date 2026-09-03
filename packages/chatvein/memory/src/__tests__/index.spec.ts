import { describe, expect, it } from 'vitest'
import { CHATVEIN_MEMORY_VERSION } from '../index'

describe('@chatvein/memory', () => {
  it('exports version', () => {
    expect(CHATVEIN_MEMORY_VERSION).toBe('0.1.0')
  })
})
