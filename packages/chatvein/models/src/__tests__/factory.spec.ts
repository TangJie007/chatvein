import { describe, expect, it, vi } from 'vitest'
import { OpenAICompatibleChatModel } from '../openai-compatible'
import { ConcurrencyLimitedChatModel } from '../semaphore'
import { createEndpointModel, createModelRouter } from '../factory'
import type { ModelEndpointConfig } from '@chatvein/common'

function endpoint(over: Partial<ModelEndpointConfig> = {}): ModelEndpointConfig {
  return {
    id: 'e1',
    baseUrl: 'https://example.com/v1',
    model: 'gpt-test',
    ...over,
  }
}

describe('createEndpointModel', () => {
  it('maxConcurrency>1 时包并发限制装饰器', () => {
    const m = createEndpointModel(endpoint({ maxConcurrency: 3 }))
    expect(m).toBeInstanceOf(ConcurrencyLimitedChatModel)
    expect((m as ConcurrencyLimitedChatModel).maxConcurrency).toBe(3)
    expect(m.id).toBe('e1')
  })

  it('未配置并发（默认串行）时不包装饰器', () => {
    const m = createEndpointModel(endpoint())
    expect(m).toBeInstanceOf(OpenAICompatibleChatModel)
    expect(m).not.toBeInstanceOf(ConcurrencyLimitedChatModel)
  })
})

describe('createModelRouter', () => {
  it('按三档端点构建路由，strong 可调用并降级', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          model: 'gpt-test',
          choices: [{ message: { content: 'ok' } }],
          usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
        }),
      }),
    )

    const router = createModelRouter({
      strong: [endpoint({ id: 's' })],
      medium: [endpoint({ id: 'm' })],
      weak: [],
    })
    const r = await router.invoke('strong', [{ role: 'user', content: 'hi' }])
    expect(r.content).toBe('ok')
    expect(r.modelId).toBe('s')
    expect(r.tier).toBe('strong')

    vi.unstubAllGlobals()
  })

  it('空档抛错', async () => {
    const router = createModelRouter({ strong: [], medium: [], weak: [] })
    await expect(
      router.invoke('weak', [{ role: 'user', content: 'x' }]),
    ).rejects.toThrow(/未配置模型档/)
  })
})
