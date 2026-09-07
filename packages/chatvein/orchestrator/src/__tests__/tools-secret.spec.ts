import { describe, expect, it } from 'vitest'
import { assertNotSecretPath } from '../tools'

describe('assertNotSecretPath', () => {
  it('blocks .env and credentials', () => {
    expect(() => assertNotSecretPath('.env')).toThrow(/敏感/)
    expect(() => assertNotSecretPath('src/.env.local')).toThrow(/敏感/)
    expect(() => assertNotSecretPath('credentials.json')).toThrow(/敏感/)
    expect(() => assertNotSecretPath('keys/id_rsa')).toThrow(/敏感/)
  })

  it('allows normal source files', () => {
    expect(() => assertNotSecretPath('src/index.ts')).not.toThrow()
    expect(() => assertNotSecretPath('package.json')).not.toThrow()
  })
})
