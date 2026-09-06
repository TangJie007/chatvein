import { describe, it, expect } from 'vitest'
import { tokenizeForBm25 } from '../tokenize-cjk'
import {
  ToolBm25Index,
  reciprocalRankFusion,
  toolBm25Doc,
} from '../tool-bm25-index'

describe('tokenizeForBm25', () => {
  it('keeps latin tokens and splits CJK into bigrams', () => {
    expect(tokenizeForBm25('read 文件')).toEqual(['read', '文件'])
    expect(tokenizeForBm25('写文章')).toEqual(['写文', '文章'])
  })

  it('splits punctuation and underscores', () => {
    expect(tokenizeForBm25('filesystem__read_text')).toEqual([
      'filesystem',
      'read',
      'text',
    ])
  })
})

describe('ToolBm25Index', () => {
  it('ranks catalog alias hits above unrelated tools', () => {
    const idx = new ToolBm25Index()
    idx.replace([
      { name: 'filesystem__write_file' },
      { name: 'calculator' },
      { name: 'duckduckgo_search' },
    ])
    const hits = idx.search('写文件', { topK: 3 })
    expect(hits[0]?.id).toBe('filesystem__write_file')
  })

  it('filters to candidate set', () => {
    const idx = new ToolBm25Index()
    idx.replace([{ name: 'filesystem__write_file' }, { name: 'calculator' }])
    const hits = idx.search('写文件', {
      topK: 5,
      candidates: new Set(['calculator']),
    })
    expect(hits.every((h) => h.id === 'calculator')).toBe(true)
    expect(hits).toHaveLength(0)
  })

  it('toolBm25Doc pulls catalog keywords as aliases', () => {
    const doc = toolBm25Doc({ name: 'calculator' })
    expect(doc?.aliases).toMatch(/计算|math/i)
  })
})

describe('reciprocalRankFusion', () => {
  it('merges ranks with weights', () => {
    const out = reciprocalRankFusion(
      [
        { ids: ['a', 'b', 'c'], weight: 1 },
        { ids: ['c', 'a'], weight: 1.25 },
      ],
      { topK: 2, rrfK: 60 },
    )
    expect(out[0]).toBe('a')
    expect(out).toHaveLength(2)
  })
})
