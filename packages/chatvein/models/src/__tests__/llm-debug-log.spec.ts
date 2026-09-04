import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  isLlmDebugLogEnabled,
  logLlmResponse,
  runWithLlmDebugLog,
  safeJsonStringify,
  toIpcSafePayload,
} from '../llm-debug-log'
import { maybeDevLlmCallbacks } from '../dev-llm-callback'

describe('llm-debug-log', () => {
  const prev = { ...process.env }

  afterEach(() => {
    process.env.CHATVEIN_LLM_DEBUG = prev.CHATVEIN_LLM_DEBUG
    process.env.NODE_ENV = prev.NODE_ENV
    process.env.ELECTRON_RENDERER_URL = prev.ELECTRON_RENDERER_URL
    vi.restoreAllMocks()
  })

  it('CHATVEIN_LLM_DEBUG=1 时无 sink 不挂回调', () => {
    process.env.CHATVEIN_LLM_DEBUG = '1'
    process.env.NODE_ENV = 'test'
    delete process.env.ELECTRON_RENDERER_URL
    expect(isLlmDebugLogEnabled()).toBe(true)
    expect(maybeDevLlmCallbacks()).toHaveLength(0)
    expect(maybeDevLlmCallbacks(() => {})).toHaveLength(1)
  })

  it('CHATVEIN_LLM_DEBUG=0 强制关闭', () => {
    process.env.CHATVEIN_LLM_DEBUG = '0'
    process.env.NODE_ENV = 'development'
    expect(isLlmDebugLogEnabled()).toBe(false)
    expect(maybeDevLlmCallbacks()).toHaveLength(0)
  })

  it('无 ALS 时回落 console.log', () => {
    process.env.CHATVEIN_LLM_DEBUG = '1'
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    logLlmResponse('test', { hello: 'world', n: 1 })
    expect(spy).toHaveBeenCalledTimes(1)
    expect(spy.mock.calls[0]![0]).toBe('[chatvein:llm:test]')
    expect(spy.mock.calls[0]![1]).toContain('"hello": "world"')
  })

  it('runWithLlmDebugLog 走 onLog 且不打 console', async () => {
    process.env.CHATVEIN_LLM_DEBUG = '1'
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const entries: Array<{ source: string; payload: unknown }> = []
    await runWithLlmDebugLog(
      {
        onLog: (source, payload) => entries.push({ source, payload }),
      },
      async () => {
        logLlmResponse('langchain', { ok: true })
        return 1
      },
    )
    expect(entries).toEqual([{ source: 'langchain', payload: { ok: true } }])
    expect(spy).not.toHaveBeenCalled()
  })

  it('safeJsonStringify 截断超长内容', () => {
    const big = { x: 'a'.repeat(10_000) }
    const s = safeJsonStringify(big, 100)
    expect(s.length).toBeLessThan(200)
    expect(s).toContain('truncated')
  })

  it('toIpcSafePayload 处理循环引用', () => {
    const a: { self?: unknown } = {}
    a.self = a
    expect(safeJsonStringify(a)).toContain('[Circular]')
    expect(toIpcSafePayload(a)).toEqual({ self: '[Circular]' })
  })
})
