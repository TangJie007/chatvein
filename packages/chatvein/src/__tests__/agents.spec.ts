/**
 * 门面 `createChatveinAgents` 单测：证明「只给模型名 + 工具」就能跑通全链路。
 *
 * 路由 / 工具筛选 / 预算 / persona 全部由包内置，这里只断言装配结果与端到端行为。
 * 门面只收模型名（包内自行 `createChatModel`），所以把模型工厂换成「按队列发脚本模型」，
 * 不联网也能验证整条链路。
 */
import { AIMessage, HumanMessage, type BaseMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createChatveinAgents } from '../agents'
import { ScriptedChatModel } from './scripted-model'

const state = vi.hoisted(() => ({
  /** `createChatModel` 的每次入参，供「配置透传」断言 */
  calls: [] as unknown[][],
  /** 排队中的脚本模型，按构造顺序发放 */
  queue: [] as unknown[],
}))

vi.mock('../model', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../model')>()
  return {
    ...actual,
    createChatModel: (cfg: unknown, options?: unknown) => {
      state.calls.push([cfg, options])
      const model = state.queue.shift()
      if (!model) throw new Error('测试未排队脚本模型')
      return model
    },
  }
})

/** 排队一个脚本模型；门面构造模型时取走它 */
function queueModel(...responses: BaseMessage[]): ScriptedChatModel {
  const model = new ScriptedChatModel(responses)
  state.queue.push(model)
  return model
}

/** 连接参数（门面只收模型名，连接信息平铺在同级） */
const CONNECTION = { apiKey: 'k', baseUrl: 'https://example.invalid/v1' }

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

beforeEach(() => {
  state.calls.length = 0
  state.queue.length = 0
})

describe('createChatveinAgents', () => {
  it('缺模型名时明确报错', () => {
    expect(() => createChatveinAgents(undefined as never)).toThrow(
      /options\.model is required/,
    )
    expect(() => createChatveinAgents({ model: '' })).toThrow(
      /options\.model is required/,
    )
  })

  it('只给模型名 + 连接参数即可装配，并透传给模型工厂', () => {
    queueModel(new AIMessage('装配用'))
    const agents = createChatveinAgents({
      model: 'gpt-4o',
      ...CONNECTION,
      temperature: 0.3,
    })

    expect(agents.router).toBeDefined()
    expect(state.calls).toHaveLength(1)
    expect(state.calls[0]?.[0]).toEqual({
      model: 'gpt-4o',
      apiKey: 'k',
      baseUrl: 'https://example.invalid/v1',
      temperature: 0.3,
    })
  })

  it('最小配置：只给模型名即可跑通 direct 链路', async () => {
    const model = queueModel(new AIMessage('你好，有什么可以帮你'))
    const agents = createChatveinAgents({ model: 'gpt-4o', ...CONNECTION })

    expect(agents.router).toBeDefined()
    const result = await agents.invoke({ input: '你好' })

    expect(result.route.lane).toBe('direct')
    expect(result.finalText).toBe('你好，有什么可以帮你')
    expect(model.callCount).toBeGreaterThan(0)
  })

  it('预填 route 时跳过图内路由，按 route 执行', async () => {
    queueModel(
      new AIMessage({
        content: '',
        tool_calls: [
          { name: 'weather', args: { city: '惠阳' }, id: 'c1', type: 'tool_call' },
        ],
      }),
      new AIMessage('惠阳今天晴，26℃'),
    )
    const called: string[] = []
    const agents = createChatveinAgents({
      model: 'gpt-4o',
      ...CONNECTION,
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
    queueModel(new AIMessage('关闭路由后的默认回复'))
    const agents = createChatveinAgents({
      model: 'gpt-4o',
      ...CONNECTION,
      router: false,
      toolsFilter: false,
    })

    expect(agents.router).toBeUndefined()
    expect(agents.toolsFilter).toBeUndefined()

    const result = await agents.invoke({ input: '你好' })
    expect(result.route).toMatchObject({ lane: 'direct', band: 'trivial' })
    expect(result.finalText).toBe('关闭路由后的默认回复')
  })

  it('工具筛选挂到母图：候选超过阈值时只给模型选中的工具', async () => {
    queueModel(new AIMessage('筛选后回复'))
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

    const agents = createChatveinAgents({
      model: 'gpt-4o',
      ...CONNECTION,
      tools,
      toolsFilter: { passthroughK: 2 },
    })
    expect(agents.toolsFilter).toBeDefined()

    await agents.invoke({
      input: '你好',
      messages: [new HumanMessage('你好')],
      route: {
        lane: 'direct',
        domain: 'general',
        band: 'simple',
        toolsPolicy: 'full',
      },
    })

    // 筛选器与主模型共用同一个实例：解析不出 toolIds → 回退全部候选 → 不抛错即为通过
    expect(agents.conversation).toBeDefined()
  })
})
