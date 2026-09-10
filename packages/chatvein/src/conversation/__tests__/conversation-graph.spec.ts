/**
 * 会话母图单测：阶段 A（entry → direct → finalize）。
 *
 * 断言「关键节点被走过」而非只看最终文本；模型一律 mock，不依赖真实网络。
 * @see docs/test/conversation-graph-eval.md
 */
import { AIMessage, HumanMessage, ToolMessage } from '@langchain/core/messages'
import { DynamicStructuredTool } from '@langchain/core/tools'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { ScriptedChatModel } from '../../__tests__/scripted-model'
import { deriveBudget } from '../../router/l0/budget'
import type { RouterDecision } from '../../router/agent'
import {
  createConversationGraph,
  dispatchAgenticWorker,
  normalizeRoute,
  routeFromRouterPlan,
  selectConversationLane,
  DEFAULT_ROUTE,
  type ConversationInvokeInput,
} from '../index'

/** 记录节点访问顺序 */
function recorder() {
  const visited: string[] = []
  return { visited, hooks: { onNode: (name: string) => visited.push(name) } }
}

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

function weatherCall(id: string, city: string) {
  return { name: 'weather', args: { city }, id, type: 'tool_call' as const }
}

describe('纯函数：route 投影', () => {
  it('E09 routeFromRouterPlan 投影 lane/domain/band/budget/query', () => {
    const route = routeFromRouterPlan({
      lane: 'direct',
      domain: 'general',
      band: 'simple',
      budget: deriveBudget('simple'),
      query: { rewritten: '惠阳天气', searchQuery: '惠阳 天气', intents: ['query'] },
      reason: '单点查询',
    })
    expect(route.lane).toBe('direct')
    expect(route.band).toBe('simple')
    expect(route.maxSteps).toBe(deriveBudget('simple').maxSteps)
    expect(route.toolsPolicy).toBe('readonly')
    expect(route.query.rewritten).toBe('惠阳天气')
    expect(route.query.intents).toEqual(['query'])
    expect(route.reason).toBe('单点查询')
  })

  it('E10 DEFAULT_ROUTE 与 deriveBudget(trivial) 同源', () => {
    const budget = deriveBudget('trivial')
    expect(DEFAULT_ROUTE.lane).toBe('direct')
    expect(DEFAULT_ROUTE.domain).toBe('general')
    expect(DEFAULT_ROUTE.band).toBe('trivial')
    expect(DEFAULT_ROUTE.maxSteps).toBe(budget.maxSteps)
    expect(DEFAULT_ROUTE.toolsPolicy).toBe(budget.toolsPolicy)
  })

  it('E00 lane/domain 映射不被破坏', () => {
    expect(selectConversationLane(normalizeRoute({ lane: 'orchestrated' }))).toBe(
      'orchestrated',
    )
    expect(dispatchAgenticWorker('general')).toBe('react_chat')
    expect(dispatchAgenticWorker('office')).toBe('react_chat')
    expect(dispatchAgenticWorker('code')).toBe('coder_task')
  })
})

describe('direct 路径：entry → reply_only → finalize', () => {
  it('E01 无 router / 无预填 → 默认 direct·general·trivial，reply_only 可达', async () => {
    const model = new ScriptedChatModel([new AIMessage('这是默认回复')])
    const { visited, hooks } = recorder()
    const graph = createConversationGraph({ model, hooks })

    const result = await graph.invoke({ input: '你好' })

    expect(visited).toEqual(['entry', 'direct:reply_only', 'finalize'])
    expect(result.route).toMatchObject({
      lane: 'direct',
      domain: 'general',
      band: 'trivial',
      toolsPolicy: 'none',
    })
    expect(result.finalText).toBe('这是默认回复')
    expect(result.messages.at(-1)?.content).toBe('这是默认回复')
  })

  it('E02 「闭包是什么」→ reply_only，模型只调用 1 次且无工具', async () => {
    const model = new ScriptedChatModel([new AIMessage('闭包是函数与其词法环境的组合')])
    const called: string[] = []
    const graph = createConversationGraph({
      model,
      tools: [weatherTool((c) => called.push(c))],
    })

    const result = await graph.invoke({
      input: '闭包是什么',
      route: { lane: 'direct', domain: 'general', band: 'trivial' },
      routeReady: true,
    })

    expect(result.route.toolsPolicy).toBe('none')
    expect(model.callCount).toBe(1)
    expect(called).toEqual([])
    expect(result.finalText).toBe('闭包是函数与其词法环境的组合')
  })

  it('E12 历史不被吞：messages 保留用户消息与助手回复', async () => {
    const model = new ScriptedChatModel([new AIMessage('收到')])
    const graph = createConversationGraph({ model })

    const result = await graph.invoke({
      messages: [new HumanMessage('Hi'), new AIMessage('你好'), new HumanMessage('在吗')],
    })

    expect(result.messages.filter((m) => HumanMessage.isInstance(m))).toHaveLength(2)
    expect(result.finalText).toBe('收到')
    expect(result.state.finalText).toBe('收到')
  })
})

describe('direct 路径：entry → one_shot → finalize', () => {
  it('E03 预填 readonly → one_shot 执行 1 次工具后收束', async () => {
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [weatherCall('c1', '惠阳')] }),
      new AIMessage('惠阳今天晴，26℃'),
    ])
    const called: string[] = []
    const { visited, hooks } = recorder()
    const graph = createConversationGraph({
      model,
      tools: [weatherTool((c) => called.push(c))],
      hooks,
    })

    const result = await graph.invoke({
      input: '惠阳天气怎么样',
      route: { lane: 'direct', domain: 'general', band: 'simple' },
      routeReady: true,
    })

    expect(visited).toEqual(['entry', 'direct:one_shot', 'finalize'])
    expect(result.route.toolsPolicy).toBe('readonly')
    expect(called).toEqual(['惠阳'])
    expect(model.callCount).toBe(2)
    expect(result.messages.some((m) => ToolMessage.isInstance(m))).toBe(true)
    expect(result.finalText).toBe('惠阳今天晴，26℃')
  })

  it('E04 模型返回 2 个 tool_calls → 只执行第一个，模型调用 ≤ 2', async () => {
    const model = new ScriptedChatModel([
      new AIMessage({
        content: '',
        tool_calls: [weatherCall('c1', '惠阳'), weatherCall('c2', '北京')],
      }),
      new AIMessage('只查了惠阳'),
    ])
    const called: string[] = []
    const graph = createConversationGraph({
      model,
      tools: [weatherTool((c) => called.push(c))],
    })

    const result = await graph.invoke({
      input: '惠阳和北京天气',
      route: {
        lane: 'direct',
        domain: 'general',
        band: 'simple',
        toolsPolicy: 'readonly',
      },
      routeReady: true,
    })

    expect(called).toEqual(['惠阳'])
    expect(model.callCount).toBeLessThanOrEqual(2)
    const toolMessages = result.messages.filter((m) => ToolMessage.isInstance(m))
    expect(toolMessages).toHaveLength(1)
    expect(result.finalText).toBe('只查了惠阳')
  })

  it('E07 toolsPolicy=none 时即使注入工具也不调用（走 reply_only）', async () => {
    const model = new ScriptedChatModel([new AIMessage('纯问答，不需要工具')])
    const called: string[] = []
    const { visited, hooks } = recorder()
    const graph = createConversationGraph({
      model,
      tools: [weatherTool((c) => called.push(c))],
      hooks,
    })

    const result = await graph.invoke({
      input: '你好',
      route: {
        lane: 'direct',
        domain: 'general',
        band: 'trivial',
        toolsPolicy: 'none',
      },
      routeReady: true,
    })

    expect(visited).toContain('direct:reply_only')
    expect(called).toEqual([])
    expect(model.callCount).toBe(1)
    expect(result.finalText).toBe('纯问答，不需要工具')
  })
})

describe('entry 路由优先级', () => {
  it('E05 lockLane / lockDomain 覆盖预填 route', async () => {
    const model = new ScriptedChatModel([new AIMessage('锁定直答')])
    const graph = createConversationGraph({
      model,
      lockLane: 'direct',
      lockDomain: 'general',
    })

    const result = await graph.invoke({
      input: '帮我重构整个项目',
      route: { lane: 'orchestrated', domain: 'code', band: 'complex' },
      routeReady: true,
    })

    expect(result.route.lane).toBe('direct')
    expect(result.route.domain).toBe('general')
    expect(result.finalText).toBe('锁定直答')
  })

  it('E06 无预填但有 router port → 调用 router 并投影 route', async () => {
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [weatherCall('c1', '惠阳')] }),
      new AIMessage('惠阳今天晴，26℃'),
    ])
    let routerText = ''
    const router = {
      route: async (input: { text: string }) => {
        routerText = input.text
        return {
          lane: 'direct',
          domain: 'general',
          band: 'simple',
          budget: deriveBudget('simple'),
          query: { rewritten: input.text },
          reason: '单点查询',
        } as unknown as RouterDecision
      },
    }
    const called: string[] = []
    const graph = createConversationGraph({
      model,
      router,
      tools: [weatherTool((c) => called.push(c))],
    })

    const result = await graph.invoke({ input: '惠阳天气' })

    expect(routerText).toBe('惠阳天气')
    expect(result.route).toMatchObject({ lane: 'direct', band: 'simple' })
    expect(result.route.toolsPolicy).toBe('readonly')
    expect(called).toEqual(['惠阳'])
    expect(result.finalText).toBe('惠阳今天晴，26℃')
  })
})

describe('预算执行点 / 未接线 lane', () => {
  it('E08 maxToolCalls=0 → one_shot 不执行工具，输出明确提示', async () => {
    const model = new ScriptedChatModel([
      new AIMessage({ content: '', tool_calls: [weatherCall('c1', '惠阳')] }),
      new AIMessage('不应到达'),
    ])
    const called: string[] = []
    const graph = createConversationGraph({
      model,
      tools: [weatherTool((c) => called.push(c))],
      budgetPolicy: { override: { maxToolCalls: 0 } },
    })

    const result = await graph.invoke({
      input: '惠阳天气',
      route: {
        lane: 'direct',
        domain: 'general',
        band: 'simple',
        toolsPolicy: 'readonly',
      },
      routeReady: true,
    })

    expect(called).toEqual([])
    expect(model.callCount).toBe(1)
    expect(result.finalText).toContain('预算上限')
    expect(result.finalText).toContain('超出工具调用上限')
  })

  it('E11 agentic / orchestrated 均由 worker 真实执行，不抛错也不留占位', async () => {
    const model = new ScriptedChatModel([new AIMessage('已按 agentic 处理')])
    const graph = createConversationGraph({ model })

    const agentic = await graph.invoke({
      input: '修一下类型报错',
      route: { lane: 'agentic', domain: 'code', band: 'standard' },
      routeReady: true,
    })
    expect(agentic.route.lane).toBe('agentic')
    expect(agentic.finalText).toBe('已按 agentic 处理')
    // code worker 未接线（阶段 B）→ 降级执行且明确标注
    expect(agentic.task.resultSummary).toContain('code worker')

    const orchestrated = await graph.invoke({
      input: '重构 utils',
      route: { lane: 'orchestrated', domain: 'code', band: 'complex' },
      routeReady: true,
    })
    expect(orchestrated.finalText).toBe('已按 agentic 处理')
    expect(orchestrated.task.resultSummary).toContain('orchestrated')
  })

  it('E13 缺少输入时明确报错', async () => {
    const model = new ScriptedChatModel([new AIMessage('x')])
    const graph = createConversationGraph({ model })
    const empty = {} as ConversationInvokeInput
    await expect(graph.invoke(empty)).rejects.toThrow(/messages or input is required/)
  })
})
