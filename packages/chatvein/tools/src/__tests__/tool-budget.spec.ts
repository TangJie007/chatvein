import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import {
  estimateToolTokens,
  estimateToolSchemaTokens,
} from '../tool-tokens'
import {
  computeToolBudgetTokens,
  inferContextWindow,
  DEFAULT_CONTEXT_WINDOW,
} from '../model-context'
import { fitToolsWithinBudget } from '../select'

describe('estimateToolTokens（成本含完整 JSON Schema）', () => {
  it('无 schema 时只算 name/description + 结构开销', () => {
    const cost = estimateToolTokens({ name: 'ping', description: 'health check' })
    expect(cost).toBeGreaterThan(0)
    // schema 为空 → 不应有参数开销
    expect(estimateToolSchemaTokens(undefined)).toBe(0)
  })

  it('带复杂参数 schema 的成本显著高于仅 name/description', () => {
    const plain = estimateToolTokens({ name: 'search', description: 'search web' })
    const withSchema = estimateToolTokens({
      name: 'search',
      description: 'search web',
      schema: z.object({
        query: z.string().describe('搜索关键词，支持布尔语法与引号精确匹配'),
        limit: z.number().min(1).max(50).describe('返回结果条数'),
        engine: z.enum(['google', 'bing', 'duckduckgo']).describe('搜索引擎选择'),
        filters: z
          .object({
            site: z.string().optional(),
            after: z.string().optional(),
            lang: z.enum(['zh', 'en', 'ja']).optional(),
          })
          .describe('过滤条件'),
      }),
    })
    // schema（参数名/类型/枚举/嵌套/描述）应占大头
    expect(withSchema).toBeGreaterThan(plain * 2)
  })

  it('schema 参数越多成本越高', () => {
    const small = estimateToolSchemaTokens(z.object({ a: z.string() }))
    const big = estimateToolSchemaTokens(
      z.object({
        a: z.string(),
        b: z.number(),
        c: z.boolean(),
        d: z.array(z.string()),
        e: z.enum(['x', 'y', 'z']),
      }),
    )
    expect(big).toBeGreaterThan(small)
  })
})

describe('inferContextWindow', () => {
  it('识别常见家族', () => {
    expect(inferContextWindow('gpt-4o')).toBe(128_000)
    expect(inferContextWindow('gpt-4o-mini')).toBe(128_000)
    expect(inferContextWindow('moonshot-v1-128k')).toBe(128_000)
    expect(inferContextWindow('moonshot-v1-8k')).toBe(8_000)
    expect(inferContextWindow('deepseek-chat')).toBe(64_000)
    expect(inferContextWindow('claude-3-5-sonnet')).toBe(200_000)
  })

  it('名称带 Nk 后缀时按后缀推断', () => {
    expect(inferContextWindow('some-vendor-32k')).toBe(32_000)
    expect(inferContextWindow('custom-200k-model')).toBe(200_000)
  })

  it('未命中走保守默认', () => {
    expect(inferContextWindow('totally-unknown-model')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(inferContextWindow('')).toBe(DEFAULT_CONTEXT_WINDOW)
    expect(inferContextWindow(undefined)).toBe(DEFAULT_CONTEXT_WINDOW)
  })
})

describe('computeToolBudgetTokens', () => {
  it('小窗口模型预算被压低（不挤占对话）', () => {
    const small = computeToolBudgetTokens({ modelId: 'moonshot-v1-8k' })
    const big = computeToolBudgetTokens({ modelId: 'gpt-4o' })
    expect(small).toBeLessThan(big)
    // 8k 窗口：15% = 1200，但有下限 1500
    expect(small).toBeGreaterThanOrEqual(1_500)
  })

  it('大窗口模型预算放开但有上限', () => {
    const huge = computeToolBudgetTokens({ modelId: 'gemini-2-pro' }) // 1M
    expect(huge).toBeLessThanOrEqual(16_000)
    expect(huge).toBeGreaterThanOrEqual(1_500)
  })

  it('结果落在 [1500, 16000] 区间', () => {
    for (const id of ['', 'gpt-4o', 'moonshot-v1-8k', 'gemini-2', 'unknown-xxx']) {
      const b = computeToolBudgetTokens({ modelId: id })
      expect(b).toBeGreaterThanOrEqual(1_500)
      expect(b).toBeLessThanOrEqual(16_000)
    }
  })

  it('显式 contextWindow 优先于 modelId 推断', () => {
    const byWindow = computeToolBudgetTokens({ contextWindow: 200_000, modelId: 'moonshot-v1-8k' })
    expect(byWindow).toBe(computeToolBudgetTokens({ contextWindow: 200_000 }))
  })
})

describe('fitToolsWithinBudget（schema 计入成本）', () => {
  it('大 schema 工具在小预算下被裁剪，但至少保留一个', () => {
    const mk = (i: number) =>
      ({
        name: `tool_${i}`,
        description: 'd',
        schema: z.object({
          q: z.string().describe('x'.repeat(200)),
          opts: z.object({
            a: z.string(),
            b: z.number(),
            c: z.enum(['one', 'two', 'three']),
          }),
        }),
      }) as never
    const tools = Array.from({ length: 8 }, (_, i) => mk(i))
    const res = fitToolsWithinBudget(tools, 800)
    expect(res.length).toBeGreaterThan(0)
    expect(res.length).toBeLessThan(8)
  })

  it('预算充足保留全部', () => {
    const tools = [
      { name: 'a', description: 'x', schema: z.object({ p: z.string() }) },
      { name: 'b', description: 'y', schema: z.object({ q: z.number() }) },
    ] as never
    expect(fitToolsWithinBudget(tools, 1_000_000)).toHaveLength(2)
  })
})
