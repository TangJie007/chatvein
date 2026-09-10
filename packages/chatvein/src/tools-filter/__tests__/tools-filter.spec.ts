/**
 * tools-filter 单测：候选少直通 / 弱模筛选 / 异常兜底。
 */
import { AIMessage } from '@langchain/core/messages'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createToolsFilterAgent } from '../agent'

function tool(name: string) {
  return new DynamicStructuredTool({
    name,
    description: `工具 ${name}`,
    schema: z.object({ q: z.string() }),
    func: async () => `${name}-ok`,
  })
}

/** 只有 invoke 的纯文本模型：走「正文 JSON 兜底」路径 */
function textModel(impl: () => AIMessage): LanguageModelLike {
  return { invoke: impl } as unknown as LanguageModelLike
}

describe('createToolsFilterAgent', () => {
  it('缺 model 时明确报错', () => {
    expect(() => createToolsFilterAgent(undefined as never)).toThrow(
      /options\.model is required/,
    )
  })

  it('无候选工具 → 空集', async () => {
    const agent = createToolsFilterAgent({ model: textModel(() => new AIMessage('{}')) })
    const res = await agent.filter({ message: '你好', tools: [] })
    expect(res).toMatchObject({ toolIds: [], via: 'passthrough_small' })
    expect(res.tools).toHaveLength(0)
  })

  it('候选数 ≤ passthroughK → 不调模型，全返', async () => {
    let called = 0
    const agent = createToolsFilterAgent({
      model: textModel(() => {
        called += 1
        return new AIMessage('{"toolIds":["a"]}')
      }),
      passthroughK: 8,
    })
    const res = await agent.filter({ message: '查天气', tools: [tool('a'), tool('b')] })
    expect(called).toBe(0)
    expect(res.via).toBe('passthrough_small')
    expect(res.toolIds).toEqual(['a', 'b'])
  })

  it('弱模给出子集 → 按相关度顺序返回候选内的工具', async () => {
    const agent = createToolsFilterAgent({
      model: textModel(() => new AIMessage('{"toolIds":["c","a","不存在"]}')),
      passthroughK: 1,
    })
    const res = await agent.filter({
      message: '查天气并写文件',
      tools: [tool('a'), tool('b'), tool('c')],
    })
    expect(res.via).toBe('text')
    expect(res.toolIds).toEqual(['c', 'a'])
    expect(res.tools.map((t) => t.name)).toEqual(['c', 'a'])
  })

  it('弱模不可用 → 回退全部候选（宁多给勿漏）', async () => {
    const agent = createToolsFilterAgent({
      model: textModel(() => {
        throw new Error('boom')
      }),
      passthroughK: 1,
      timeoutMs: 50,
    })
    const res = await agent.filter({
      message: '查天气',
      tools: [tool('a'), tool('b')],
    })
    expect(res.via).toBe('fallback')
    expect(res.toolIds).toEqual(['a', 'b'])
  })
})
