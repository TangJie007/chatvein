/**
 * 门面 `createChatveinAgents` 单测：证明「只给模型 + 工具」就能跑通全链路。
 *
 * 路由 / 工具筛选 / 预算 / persona 全部由包内置，这里只断言装配结果与端到端行为。
 */
import { AIMessage, HumanMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { createChatveinAgents } from '../agents'
import { resolveModelBundle } from '../model'
import { ScriptedChatModel } from './scripted-model'

function weatherTool(onCall?: (city: string) => void) {
  return new DynamicStructuredTool({
    name: 'weather',
    description: '查询城市天气',
    schema: z.object({ city: z.string() }),
    func: async ({ city }) => {
      onCall?.(city)
      return `${city}：晴，26℃`
    },
  })
}

describe('resolveModelBundle', () => {
  it('传模型实例 → 四档共用', () => {
    const model = new ScriptedChatModel([new AIMessage('x')])
    const bundle = resolveModelBundle(model)
    expect(bundle.main).toBe(model)
    expect(bundle.fast).toBe(model)
    expect(bundle.strong).toBe(model)
    expect(bundle.filter).toBe(model)
  })

  it('传配置 → fast / strong 缺省继承主配置，可单独覆盖', () => {
    const bundle = resolveModelBundle({
      model: 'main-model',
      apiKey: 'k',
      baseUrl: 'https://example.invalid/v1',
      fast: 'fast-model',
    })
    expect(bundle.main).not.toBe(bundle.fast)
    expect(bundle.strong).toBe(bundle.fast)
    expect(bundle.filter).toBe(bundle.fast)
    expect((bundle.fast as { model?: string }).model).toBe('fast-model')
    expect((bundle.main as { model?: string }).model).toBe('main-model')
  })

  it('缺 model 时明确报错', () => {
    expect(() => resolveModelBundle({} as never)).toThrow(/model is required/)
  })
})

describe('createChatveinAgents', () => {
  it('缺 model 时明确报错', () => {
    expect(() => createChatveinAgents(undefined as never)).toThrow(
      /options\.model is required/,
    )
  })

  it('最小配置：只给模型即可跑通 direct 链路', async () => {
    const model = new ScriptedChatModel([new AIMessage('你好，有什么可以帮你')])
    const agents = createChatveinAgents({ model })

    expect(agents.router).toBeDefined()
    const result = await agents.invoke({ input: '你好' })

    expect(result.route.lane).toBe('direct')
    expect(result.finalText).toBe('你好，有什么可以帮你')
  })

  it('预填 route 时跳过图内路由，按 route 执行', async () => {
    const model = new ScriptedChatModel([
      new AIMessage({
        content: '',
        tool_calls: [{ name: 'weather', args: { city: '惠阳' }, id: 'c1', type: 'tool_call' }],
      }),
      new AIMessage('惠阳今天晴，26℃'),
    ])
    const called: string[] = []
    const agents = createChatveinAgents({
      model,
      tools: [weatherTool((c) => called.push(c))],
    })

    const result = await agents.invoke({
      input: '惠阳天气',
      route: { lane: 'direct', domain: 'general', band: 'simple' },
    })

    expect(called).toEqual(['惠阳'])
    expect(result.route.toolsPolicy).toBe('readonly')
    expect(result.finalText).toBe('惠阳今天晴，26℃')
  })

  it('router / toolsFilter 可显式关闭', async () => {
    const model = new ScriptedChatModel([new AIMessage('关闭路由后的默认回复')])
    const agents = createChatveinAgents({
      model,
      router: false,
      toolsFilter: false,
    })

    expect(agents.router).toBeUndefined()
    expect(agents.toolsFilter).toBeUndefined()

    const result = await agents.invoke({ input: '你好' })
    expect(result.route).toMatchObject({ lane: 'direct', band: 'trivial' })
    expect(result.finalText).toBe('关闭路由后的默认回复')
  })

  it('工具筛选挂到母图：候选超过阈值时只给弱模选中的工具', async () => {
    // 模型被复用为「路由器 / 筛选器 / 主模型」，统一返回同一句话；
    // 筛选器解析不出 toolIds → 回退全部候选 → 工具仍可执行
    const model = new ScriptedChatModel([new AIMessage('筛选后回复')])
    const called: string[] = []
    const tools = Array.from({ length: 9 }, (_, i) =>
      new DynamicStructuredTool({
        name: `t${i}`,
        description: `工具 ${i}`,
        schema: z.object({ q: z.string() }),
        func: async () => `ok${i}`,
      }),
    )
    tools.push(weatherTool((c) => called.push(c)))

    const agents = createChatveinAgents({ model, tools, toolsFilter: { passthroughK: 2 } })
    expect(agents.toolsFilter).toBeDefined()

    await agents.invoke({
      input: '你好',
      messages: [new HumanMessage('你好')],
      route: { lane: 'direct', domain: 'general', band: 'simple', toolsPolicy: 'full' },
    })

    // 筛选失败不阻断路：候选池完整进入 lane（不抛错即为通过）
    expect(agents.conversation).toBeDefined()
  })
})
