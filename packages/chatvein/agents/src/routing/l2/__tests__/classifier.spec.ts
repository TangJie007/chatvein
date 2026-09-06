import { describe, expect, it, vi } from 'vitest'
import { parseRouteDecision } from '@chatvein/common'
import { createHeuristicRouter } from '../../pipeline'
import {
  createL2Classifier,
  mergeL2Judgement,
  shouldEscalateToL2,
  extractJsonObject,
  parseL2Judgement,
} from '../index'

describe('L2 merge + schema', () => {
  const l1Unknown = parseRouteDecision({
    band: 'unknown',
    confident: false,
    policy: { modelTier: 'medium', tools: 'full', maxSteps: 16, memoryRecall: true },
    score: 0,
    reasons: ['defer_to_l2'],
    ruleIds: [],
  })

  it('merge 写入 band/tools 与 rewrittenQuery', () => {
    const d = mergeL2Judgement(l1Unknown, {
      band: 'simple',
      tools: 'none',
      modelTier: 'weak',
      maxSteps: 2,
      confident: true,
      reason: '短问答',
      rewrittenQuery: '解释编程语言中的闭包概念',
    })
    expect(d.band).toBe('simple')
    expect(d.policy.tools).toBe('none')
    expect(d.rewrittenQuery).toBe('解释编程语言中的闭包概念')
    expect(d.ruleIds).toContain('l2')
    expect(d.reasons.some((r) => r.startsWith('l2:'))).toBe(true)
  })

  it('extractJsonObject 容忍前后缀；rewrittenQuery 必填', () => {
    const raw = extractJsonObject(
      '好的\n{"band":"standard","tools":"full","confident":true,"rewrittenQuery":"查询上海天气"}\n',
    )
    expect(parseL2Judgement(raw).band).toBe('standard')
    expect(parseL2Judgement(raw).rewrittenQuery).toBe('查询上海天气')
  })
})

describe('StructuredL2Classifier', () => {
  it('callModel 成功则覆盖 L1 并带改写（文本路径）', async () => {
    const callModel = vi.fn(async () =>
      JSON.stringify({
        band: 'standard',
        tools: 'full',
        confident: true,
        reason: '需查信息',
        rewrittenQuery: '检索并说明该话题的背景资料',
      }),
    )
    const l2 = createL2Classifier({ callModel })
    const router = createHeuristicRouter({ l2 })
    const d = await router.route({ text: 'hello what is this about really' })
    expect(shouldEscalateToL2(await createHeuristicRouter().route({ text: 'hello what is this about really' }))).toBe(
      true,
    )
    expect(d.policy.tools).toBe('full')
    expect(d.band).toBe('standard')
    expect(d.rewrittenQuery).toContain('检索')
    expect(d.reasons).toContain('l2_classifier')
    expect(d.reasons).toContain('l2_text')
    expect(callModel).toHaveBeenCalledOnce()
  })

  it('model.withStructuredOutput 成功 → l2_structured', async () => {
    const model = {
      withStructuredOutput: () => ({
        invoke: vi.fn(async () => ({
          band: 'standard',
          tools: 'full',
          confident: true,
          rewrittenQuery: '查询上海天气',
        })),
      }),
      invoke: vi.fn(async () => {
        throw new Error('不应走文本')
      }),
    }
    const l2 = createL2Classifier({ model: model as never })
    const d = await createHeuristicRouter({ l2 }).route({ text: '今天上海天气怎么样' })
    expect(d.band).toBe('standard')
    expect(d.rewrittenQuery).toBe('查询上海天气')
    expect(d.reasons).toContain('l2_structured')
    expect(model.invoke).not.toHaveBeenCalled()
  })

  it('response_format 不支持 → 文本 JSON 兜底 l2_text', async () => {
    const model = {
      withStructuredOutput: () => ({
        invoke: async () => {
          throw new Error('400 This response_format type is unavailable now')
        },
      }),
      invoke: vi.fn(async () => ({
        content:
          '好的\n{"band":"simple","tools":"full","confident":true,"rewrittenQuery":"查询上海市今日天气预报"}\n',
      })),
    }
    const l2 = createL2Classifier({ model: model as never })
    const d = await createHeuristicRouter({ l2 }).route({ text: '今天上海天气怎么样' })
    expect(d.band).toBe('simple')
    expect(d.rewrittenQuery).toBe('查询上海市今日天气预报')
    expect(d.reasons).toContain('l2_text')
    expect(model.invoke).toHaveBeenCalledOnce()
  })

  it('天气查询进 L2', async () => {
    const callModel = vi.fn(async () =>
      JSON.stringify({
        band: 'simple',
        tools: 'full',
        confident: true,
        reason: '天气查询',
        rewrittenQuery: '查询上海市今日天气预报',
      }),
    )
    const l2 = createL2Classifier({ callModel })
    const router = createHeuristicRouter({ l2 })
    const d = await router.route({ text: '今天上海天气怎么样' })
    expect(callModel).toHaveBeenCalledOnce()
    expect(d.band).toBe('simple')
    expect(d.rewrittenQuery).toBe('查询上海市今日天气预报')
  })

  it('callModel 失败则保留 L1 并标记 l2_failed', async () => {
    const l2 = createL2Classifier({
      callModel: async () => {
        throw new Error('boom')
      },
    })
    const router = createHeuristicRouter({ l2 })
    const d = await router.route({ text: '今天上海天气怎么样' })
    expect(d.band).toBe('unknown')
    expect(d.reasons).toContain('l2_failed')
    expect(d.rewrittenQuery).toBeUndefined()
  })

  it('寒暄不进 L2', async () => {
    const callModel = vi.fn(async () => '{}')
    const router = createHeuristicRouter({ l2: createL2Classifier({ callModel }) })
    const d = await router.route({ text: '你好' })
    expect(d.band).toBe('trivial')
    expect(callModel).not.toHaveBeenCalled()
  })
})
