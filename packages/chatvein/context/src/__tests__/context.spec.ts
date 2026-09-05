import { describe, expect, it } from 'vitest'
import { CHATVEIN_CONTEXT_VERSION, estimateTextTokens, truncateFolded } from '../index'

describe('estimateTextTokens', () => {
  it('空串为 0', () => {
    expect(estimateTextTokens('')).toBe(0)
  })

  it('中文按 ~0.7 token/字 估算', () => {
    expect(estimateTextTokens('你好世界')).toBe(3)
  })

  it('ASCII 按 ~0.25 token/字符 估算', () => {
    expect(estimateTextTokens('hello world')).toBe(3)
  })
})

describe('truncateFolded', () => {
  it('未超预算时原样返回', () => {
    const text = 'a\nb\nc'
    const res = truncateFolded(text, 1000)
    expect(res).toEqual({ text, truncated: false, omittedLines: 0 })
  })

  it('超预算时头尾保留、中间折叠并标注省略行数', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`)
    const res = truncateFolded(lines.join('\n'), 30)
    expect(res.truncated).toBe(true)
    expect(res.omittedLines).toBeGreaterThan(0)
    expect(res.text).toContain('已省略')
    expect(res.text.startsWith('line-0')).toBe(true)
    expect(res.text.endsWith('line-19')).toBe(true)
  })

  it('单行超预算时退化为硬切头部', () => {
    const long = 'x'.repeat(4000)
    const res = truncateFolded(long, 20)
    expect(res.truncated).toBe(true)
    expect(res.text.length).toBeLessThan(long.length)
  })

  it('导出版本号', () => {
    expect(CHATVEIN_CONTEXT_VERSION).toBe('0.1.0')
  })
})
