import { describe, expect, it } from 'vitest'
import { loadDefaultPrototypes } from '../../locales'
import { RouteBm25Index, tokenizeForBm25 } from '../bm25-index'

describe('RouteBm25Index', () => {
  it('tokenize 中英', () => {
    expect(tokenizeForBm25('hello world')).toEqual(['hello', 'world'])
    expect(tokenizeForBm25('你好世界')).toContain('你好')
  })

  it('检索中文先例并投票', () => {
    const idx = new RouteBm25Index({ scoreMin: 0.01, voteRatio: 0.5 })
    const prototypes = loadDefaultPrototypes()
    idx.reload(prototypes)
    expect(idx.size).toBe(prototypes.length)
    expect(idx.size).toBeGreaterThan(40)
    const hits = idx.search('修复 TypeScript 报错', 'zh')
    expect(hits.length).toBeGreaterThan(0)
    const vote = idx.vote(hits)
    expect(vote).not.toBeNull()
    expect(vote!.band).toBeTruthy()
  })

  it('天气查询类能命中先例', () => {
    const idx = new RouteBm25Index({ scoreMin: 0.01, voteRatio: 0.5 })
    idx.reload(loadDefaultPrototypes())
    const hits = idx.search('查询一下今天北京的天气', 'zh')
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.id.startsWith('zh-weather') || h.band === 'simple')).toBe(true)
  })

  it('低分不返回 hits', () => {
    const idx = new RouteBm25Index({ scoreMin: 999 })
    idx.reload(loadDefaultPrototypes())
    expect(idx.search('你好')).toEqual([])
  })
})
