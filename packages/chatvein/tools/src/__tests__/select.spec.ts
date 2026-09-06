import { describe, it, expect } from 'vitest'
import { keywordSelect, llmSelectTools, fitToolsWithinBudget } from '../select'
import type { ToolCatalogEntry } from '../types'

const candidates: ToolCatalogEntry[] = [
  {
    id: 'fs_read',
    category: 'local_fs',
    title: '读文件',
    description: '读取本地文件内容',
    source: 'mcp',
    defaultEnabled: true,
    keywords: ['file', '读'],
  },
  {
    id: 'calc',
    category: 'compute',
    title: '计算器',
    description: '计算数学表达式',
    source: 'builtin',
    defaultEnabled: true,
  },
]

describe('keywordSelect', () => {
  it('按关键词命中返回候选（降序）', () => {
    expect(keywordSelect('读取文件', candidates)).toEqual(['fs_read', 'calc'])
  })
  it('空 query 返回全部候选', () => {
    expect(keywordSelect('', candidates)).toEqual(['fs_read', 'calc'])
  })
})

describe('llmSelectTools', () => {
  const cand = [
    { name: 'fs_read', description: '读文件' },
    { name: 'calc', description: '计算' },
    { name: 'web_search', description: '搜索网页' },
  ]

  it('返回被候选集过滤后的 toolIds', async () => {
    const fake = {
      withStructuredOutput: () => ({ invoke: async () => ({ toolIds: ['fs_read', 'calc'] }) }),
    } as never
    const res = await llmSelectTools('读文件并计算', cand, fake, { maxK: 2 })
    expect(res).toEqual({ toolIds: ['fs_read', 'calc'], status: 'selected' })
  })

  it('结果为空/失败 → 回退全部候选', async () => {
    const fake = {
      withStructuredOutput: () => ({ invoke: async () => ({ toolIds: [] }) }),
    } as never
    const res = await llmSelectTools('q', cand, fake, { maxK: 2 })
    expect(res).toEqual({
      toolIds: ['fs_read', 'calc', 'web_search'],
      status: 'fallback_empty',
    })
  })

  it('候选数 ≤ maxK 时跳过弱模型调用', async () => {
    const fake = {
      withStructuredOutput: () => ({ invoke: async () => { throw new Error('不应被调用') } }),
    } as never
    const res = await llmSelectTools('q', cand.slice(0, 2), fake, { maxK: 10 })
    expect(res).toEqual({ toolIds: ['fs_read', 'calc'], status: 'passthrough_small' })
  })
})

describe('fitToolsWithinBudget', () => {
  it('预算充足时保留全部', () => {
    const tools = [{ name: 'a', description: 'x' }, { name: 'b', description: 'y' }] as never
    expect(fitToolsWithinBudget(tools, 100000).map((t) => (t as { name: string }).name)).toEqual([
      'a',
      'b',
    ])
  })

  it('超预算时截断低相关项，但至少保留一个', () => {
    const tools = Array.from({ length: 10 }, (_, i) => ({
      name: `t${i}`,
      description: 'word '.repeat(500),
    })) as never
    const res = fitToolsWithinBudget(tools, 50)
    expect(res.length).toBeLessThan(10)
    expect(res.length).toBeGreaterThan(0)
  })
})
