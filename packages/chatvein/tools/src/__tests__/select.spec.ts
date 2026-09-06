import { describe, it, expect, vi } from 'vitest'
import {
  keywordSelect,
  llmSelectTools,
  fitToolsWithinBudget,
  isResponseFormatUnsupported,
} from '../select'
import {
  TOOL_SELECT_SYSTEM_PROMPT,
  buildToolSelectPromptVars,
  formatToolSelectList,
  formatToolSelectPromptMessages,
  toolSelectChatPromptTemplate,
} from '../select-prompt'
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

describe('toolSelectChatPromptTemplate', () => {
  it('formatMessages 含 query / 工具列表 / maxK', async () => {
    const cand = [
      { name: 'fs_read', description: '读文件' },
      { name: 'calc', description: { weird: true } },
    ]
    const messages = await formatToolSelectPromptMessages('写一篇夏的文章', cand, 10)
    expect(messages).toHaveLength(2)
    expect(String(messages[0]!.content)).toContain('至多选出 10 个')
    const human = String(messages[1]!.content)
    expect(human).toContain('写一篇夏的文章')
    expect(human).toContain('"weird":true')
    expect(human).not.toContain('[object Object]')
  })

  it('formatToolSelectList 把非字符串 description 序列化', () => {
    const list = formatToolSelectList([{ name: 'x', description: { a: 1 } }])
    expect(list).toContain('{"a":1}')
  })

  it('template 与 helper 一致', async () => {
    const cand = [{ name: 'a', description: 'b' }]
    const vars = buildToolSelectPromptVars('q', cand, 3)
    const viaT = await toolSelectChatPromptTemplate.formatMessages(vars)
    const viaH = await formatToolSelectPromptMessages('q', cand, 3)
    expect(String(viaT[1]!.content)).toBe(String(viaH[1]!.content))
    expect(TOOL_SELECT_SYSTEM_PROMPT).toContain('{maxK}')
  })
})

describe('isResponseFormatUnsupported', () => {
  it('识别常见文案', () => {
    expect(
      isResponseFormatUnsupported(new Error('400 This response_format type is unavailable now')),
    ).toBe(true)
    expect(isResponseFormatUnsupported(new Error('timeout'))).toBe(false)
  })
})

describe('llmSelectTools', () => {
  const cand = [
    { name: 'fs_read', description: '读文件' },
    { name: 'calc', description: '计算' },
    { name: 'web_search', description: '搜索网页' },
  ]

  it('withStructuredOutput 成功 → selected_structured', async () => {
    const fake = {
      withStructuredOutput: () => ({
        invoke: vi.fn(async () => ({ toolIds: ['fs_read', 'calc'] })),
      }),
      invoke: vi.fn(async () => {
        throw new Error('不应走文本')
      }),
    } as never
    const res = await llmSelectTools('读文件并计算', cand, fake, { maxK: 2 })
    expect(res).toEqual({ toolIds: ['fs_read', 'calc'], status: 'selected_structured' })
  })

  it('response_format 不支持 → 文本 JSON 兜底 selected_text', async () => {
    const fake = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('400 This response_format type is unavailable now')
        },
      }),
      invoke: vi.fn(async () => ({
        content: '好的\n{"toolIds":["fs_read"]}\n',
      })),
    } as never
    const res = await llmSelectTools('读文件', cand, fake, { maxK: 2 })
    expect(res).toEqual({ toolIds: ['fs_read'], status: 'selected_text' })
    expect(fake.invoke).toHaveBeenCalledOnce()
  })

  it('无 withStructuredOutput → 直接文本路径', async () => {
    const fake = {
      invoke: async () => ({ content: '{"toolIds":["calc"]}' }),
    } as never
    const res = await llmSelectTools('计算', cand, fake, { maxK: 2 })
    expect(res).toEqual({ toolIds: ['calc'], status: 'selected_text' })
  })

  it('结构化返回空 → fallback_empty（不再打文本）', async () => {
    const invoke = vi.fn()
    const fake = {
      withStructuredOutput: () => ({
        invoke: async () => ({ toolIds: [] }),
      }),
      invoke,
    } as never
    const res = await llmSelectTools('q', cand, fake, { maxK: 2 })
    expect(res.status).toBe('fallback_empty')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('结构化超时 → fallback_error（不再打文本）', async () => {
    const invoke = vi.fn()
    const fake = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('llmSelectTools timeout')
        },
      }),
      invoke,
    } as never
    const res = await llmSelectTools('q', cand, fake, { maxK: 2 })
    expect(res.status).toBe('fallback_error')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('文本路径也失败 → fallback_error', async () => {
    const fake = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('response_format unavailable')
        },
      }),
      invoke: async () => {
        throw new Error('network boom')
      },
    } as never
    const res = await llmSelectTools('q', cand, fake, { maxK: 2 })
    expect(res.status).toBe('fallback_error')
    expect(res.toolIds).toHaveLength(3)
  })

  it('候选数 ≤ maxK 时跳过弱模型调用', async () => {
    const fake = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('不应被调用')
        },
      }),
      invoke: async () => {
        throw new Error('不应被调用')
      },
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
