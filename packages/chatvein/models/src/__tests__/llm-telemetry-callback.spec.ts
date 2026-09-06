import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  LlmTelemetryCallbackHandler,
  llmTelemetryCallbacks,
  summarizeMessages,
} from '../llm-telemetry-callback'
import { setTelemetrySink, type TelemetryEvent } from '@chatvein/observability'
import { AIMessage, HumanMessage } from '@langchain/core/messages'

describe('llm-telemetry-callback', () => {
  const prev = { ...process.env }
  let clearSink: (() => void) | undefined

  afterEach(() => {
    process.env.CHATVEIN_LLM_DEBUG = prev.CHATVEIN_LLM_DEBUG
    process.env.NODE_ENV = prev.NODE_ENV
    clearSink?.()
    clearSink = undefined
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  it('summarizeMessages 抽出 role/content/tool_calls', () => {
    const out = summarizeMessages([
      new HumanMessage('hi'),
      new AIMessage({
        content: 'yo',
        tool_calls: [{ name: 'calc', args: { x: 1 }, id: '1', type: 'tool_call' }],
      }),
    ]) as Array<Record<string, unknown>>
    expect(out[0]).toMatchObject({ role: 'human', content: 'hi' })
    expect(out[1]).toMatchObject({ role: 'ai', content: 'yo' })
    expect(out[1]!.tool_calls).toHaveLength(1)
  })

  it('llmTelemetryCallbacks 为无状态单例数组', () => {
    expect(llmTelemetryCallbacks).toHaveLength(1)
    expect(llmTelemetryCallbacks[0]).toBeInstanceOf(LlmTelemetryCallbackHandler)
  })

  it('一次调用发出可关联的 request/response：spanId=runId、带 durationMs/tokens/attrs', async () => {
    process.env.CHATVEIN_LLM_DEBUG = '1'
    vi.useFakeTimers()
    const entries: TelemetryEvent[] = []
    clearSink = setTelemetrySink((e) => entries.push(e))
    const handler = new LlmTelemetryCallbackHandler()

    handler.handleChatModelStart(
      { id: ['ChatOpenAI'] } as never,
      [[new HumanMessage('ping')]],
      'run-1',
    )
    handler.handleLLMEnd(
      {
        generations: [[{ text: 'pong', message: new AIMessage('pong') }]],
        llmOutput: { tokenUsage: { totalTokens: 3 } },
      } as never,
      'run-1',
    )
    await vi.runAllTimersAsync()

    expect(entries.map((e) => e.name)).toEqual(['llm:request', 'llm:response'])
    // 信封关联：spanId 统一为 LangChain runId
    expect(entries[0]!.spanId).toBe('run-1')
    expect(entries[1]!.spanId).toBe('run-1')
    // response 带状态/耗时/维度
    expect(entries[1]!.status).toBe('ok')
    expect(typeof entries[1]!.durationMs).toBe('number')
    expect(entries[1]!.attrs).toMatchObject({
      source: 'langchain',
      tokens: { totalTokens: 3 },
    })
    // 业务字段仍在 payload
    expect(entries[0]!.payload).toMatchObject({ runId: 'run-1' })
    expect(entries[1]!.payload).toMatchObject({ runId: 'run-1' })
  })

  it('error 路径带 status=error、error 与 durationMs', async () => {
    process.env.CHATVEIN_LLM_DEBUG = '1'
    vi.useFakeTimers()
    const entries: TelemetryEvent[] = []
    clearSink = setTelemetrySink((e) => entries.push(e))
    const handler = new LlmTelemetryCallbackHandler()

    handler.handleChatModelStart({ id: ['ChatOpenAI'] } as never, [[new HumanMessage('x')]], 'run-2')
    handler.handleLLMError(new Error('boom'), 'run-2')
    await vi.runAllTimersAsync()

    expect(entries.map((e) => e.name)).toEqual(['llm:request', 'llm:error'])
    const err = entries[1]!
    expect(err.spanId).toBe('run-2')
    expect(err.status).toBe('error')
    expect(err.error).toBe('boom')
    expect(typeof err.durationMs).toBe('number')
    expect(err.attrs).toMatchObject({ source: 'langchain' })
  })

  it('遥测关闭且无 sink 时不抛错（回落路径静默）', async () => {
    process.env.CHATVEIN_LLM_DEBUG = '0'
    process.env.NODE_ENV = 'test'
    delete process.env.ELECTRON_RENDERER_URL
    vi.useFakeTimers()
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const handler = new LlmTelemetryCallbackHandler()
    expect(() => handler.handleLLMEnd({ generations: [[{ text: 'pong' }]], llmOutput: {} } as never, 'run-3')).not.toThrow()
    await vi.runAllTimersAsync()
    expect(spy).not.toHaveBeenCalled()
  })
})
