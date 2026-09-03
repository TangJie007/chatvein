import { describe, expect, it } from 'vitest'
import { CHATVEIN_VECTOR_VERSION } from '../index'

describe('@chatvein/vector', () => {
  it('exports version', () => {
    expect(CHATVEIN_VECTOR_VERSION).toBe('0.1.0')
  })
})
