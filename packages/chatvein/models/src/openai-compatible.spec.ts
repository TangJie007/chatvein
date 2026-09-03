import { describe, expect, it, vi } from 'vitest'
import { ModelError, type ChatModelLike, type ModelResult } from '@chatvein/common'
import { MeteredChatModel } from './meter'
import { OpenAICompatibleChatModel } from './openai-compatible'
import { ModelRouter } from './router'

function fakeModel(id: string, impl: ChatModelLike['invoke']): ChatModelLike {
  return { id, invoke: impl }
}

function ok(content = 'hi'): ModelResult {
  return {
    content,
    usage: { promptTokens: 2, completionTokens: 3, totalTokens: 5 },
    model: 'm',
    latencyMs: 1,
  }
}

describe('OpenAICompatibleChatModel', () => {
  it('成功解析 content 与 usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        model: 'gpt-test',
        choices: [{ message: { content: '  你好  ' } }],
        usage: { prompt_tokens: 10, completion_tokens: 4, total_tokens: 14 },
      }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const model = new OpenAICompatibleChatModel({
      id: 't1',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-test',
      apiKey: 'sk-x',
    })
    const result = await model.invoke([{ role: 'user', content: 'hi' }])

    expect(result.content).toBe('你好')
    expect(result.usage.totalTokens).toBe(14)
    expect(fetchMock).toHaveBeenCalledOnce()
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(JSON.parse(String(init.body)).stream).toBe(false)

    vi.unstubAllGlobals()
  })

  it('HTTP 错误抛 ModelError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: { message: 'rate' } }),
      }),
    )
    const model = new OpenAICompatibleChatModel({
      id: 't1',
      baseUrl: 'https://example.com/v1',
      model: 'gpt-test',
    })
    await expect(model.invoke([{ role: 'user', content: 'hi' }])).rejects.toMatchObject({
      code: 'MODEL_RATE_LIMIT',
    })
    vi.unstubAllGlobals()
  })
})

describe('MeteredChatModel', () => {
  it('累加 TokenStat', async () => {
    const inner = fakeModel('a', async () => ok())
    const metered = new MeteredChatModel(inner)
    await metered.invoke([{ role: 'user', content: '1' }])
    await metered.invoke([{ role: 'user', content: '2' }])
    const stat = metered.getStat()
    expect(stat.total.totalTokens).toBe(10)
    expect(stat.byModel.m.totalTokens).toBe(10)
  })
})

describe('ModelRouter', () => {
  it('首发失败后降级到备用', async () => {
    const primary = fakeModel('p', async () => {
      throw new ModelError('超时', 'MODEL_TIMEOUT')
    })
    const backup = fakeModel('b', async () => ok('from-b'))
    const fallbacks: string[] = []
    const router = new ModelRouter({
      tiers: { strong: [primary, backup], medium: [], weak: [] },
      onFallback: (info) => fallbacks.push(`${info.fromId}->${info.toId}`),
    })

    const result = await router.invoke('strong', [{ role: 'user', content: 'x' }])
    expect(result.content).toBe('from-b')
    expect(result.modelId).toBe('b')
    expect(fallbacks).toEqual(['p->b'])
  })
})
