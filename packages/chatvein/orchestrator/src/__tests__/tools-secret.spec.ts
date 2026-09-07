import { describe, expect, it } from 'vitest'
import {
  applyExactReplace,
  assertNotSecretPath,
  summarizeReplaceDiff,
} from '@chatvein/sandbox'

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

describe('applyExactReplace', () => {
  const src = ['function a() {', '  return 1', '}', '', 'function b() {', '  return 1', '}'].join(
    '\n',
  )

  it('replaces a unique occurrence', () => {
    const { next, count } = applyExactReplace(src, 'function a() {\n  return 1\n}', 'function a() {\n  return 2\n}')
    expect(count).toBe(1)
    expect(next).toContain('function a() {\n  return 2\n}')
    expect(next).toContain('function b() {\n  return 1\n}')
  })

  it('rejects ambiguous match unless replace_all', () => {
    expect(() => applyExactReplace(src, '  return 1', '  return 9')).toThrow(/匹配 2 处/)
    const { next, count } = applyExactReplace(src, '  return 1', '  return 9', true)
    expect(count).toBe(2)
    expect(next).not.toContain('return 1')
  })

  it('rejects missing / empty / noop', () => {
    expect(() => applyExactReplace(src, 'nope', 'x')).toThrow(/未在文件中找到/)
    expect(() => applyExactReplace(src, '', 'x')).toThrow(/不能为空/)
    expect(() => applyExactReplace(src, 'return 1', 'return 1')).toThrow(/相同/)
  })
})

describe('summarizeReplaceDiff', () => {
  it('includes +/- hunk lines', () => {
    const before = 'a\nold\nb\n'
    const after = 'a\nnew\nb\n'
    const diff = summarizeReplaceDiff(before, after, 'old', 'new')
    expect(diff).toContain('-old')
    expect(diff).toContain('+new')
  })
})
