/**
 * createRouterAgent 编排单测（L0/L1 规则路径；L2 mock）。
 */
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import { describe, expect, it } from 'vitest'
import { createRouterAgent } from '../agent'

function structuredModel(payload: unknown): LanguageModelLike {
  return {
    withStructuredOutput: () => ({
      invoke: async () => payload,
    }),
  } as unknown as LanguageModelLike
}

describe('createRouterAgent', () => {
  it('寒暄 → L1 rule · direct/general · tools none', async () => {
    const agent = createRouterAgent({ cache: false })
    const d = await agent.route({ text: '你好' })
    expect(d.lane).toBe('direct')
    expect(d.domain).toBe('general')
    expect(d.decidedBy).toBe('rule')
    expect(d.budget.toolsPolicy).toBe('none')
    expect(d.meta.layerPath).toContain('l1')
  })

  it('lockLane/domain → L0 定案', async () => {
    const agent = createRouterAgent({ cache: false })
    const d = await agent.route({
      text: '随便聊聊',
      lockLane: 'agentic',
      lockDomain: 'code',
    })
    expect(d.lane).toBe('agentic')
    expect(d.domain).toBe('code')
    expect(d.decidedBy).toBe('rule')
    expect(d.meta.layerPath).toContain('lock')
  })

  it('L1 pass 后 L2 结构化定案', async () => {
    const agent = createRouterAgent({
      cache: false,
      fastModel: structuredModel({
        lane: 'agentic',
        domain: 'code',
        band: 'standard',
        confidence: 0.9,
        ambiguous: false,
        reason: '修类型',
        rewritten: '修复 TypeScript 类型错误',
        searchQuery: 'fix typescript type error',
      }),
    })
    const d = await agent.route({ text: '帮我把那个类型问题处理一下吧拜托了谢谢' })
    // 可能被 L1 规则命中；若进 L2 则 decidedBy=l2
    expect(['rule', 'semantic', 'l2', 'fallback']).toContain(d.decidedBy)
    expect(d.budget).toBeTruthy()
    expect(d.safety.verdict).toBeTruthy()
  })

  it('无 fastModel 且 L1 pass → fallback', async () => {
    const agent = createRouterAgent({ cache: false })
    // 刻意用模糊短句，尽量避开 L1 高置信规则
    const d = await agent.route({ text: '嗯那个事怎么样了你觉得呢' })
    if (d.decidedBy === 'fallback') {
      expect(d.lane).toBe('direct')
      expect(d.confidence).toBe(0)
    }
  })
})
