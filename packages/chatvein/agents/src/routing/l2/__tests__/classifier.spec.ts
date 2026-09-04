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
    policy: { modelTier: 'medium', tools: 'unknown', maxSteps: 8, memoryRecall: true },
    score: 0,
    reasons: ['no_strong_signal'],
    ruleIds: [],
  })

  it('merge 消化 tools unknown 与 band unknown', () => {
    const d = mergeL2Judgement(l1Unknown, {
      band: 'simple',
      tools: 'none',
      modelTier: 'weak',
      maxSteps: 2,
      confident: true,
      reason: '短问答',
    })
    expect(d.band).toBe('simple')
    expect(d.policy.tools).toBe('none')
    expect(d.policy.modelTier).toBe('weak')
    expect(d.confident).toBe(true)
    expect(d.ruleIds).toContain('l2')
    expect(d.reasons.some((r) => r.startsWith('l2:'))).toBe(true)
  })

  it('extractJsonObject 容忍前后缀', () => {
    const raw = extractJsonObject('好的\n{"band":"standard","tools":"full","confident":true}\n')
    expect(parseL2Judgement(raw).band).toBe('standard')
  })
})

describe('StructuredL2Classifier', () => {
  it('callModel 成功则覆盖 L1 灰区', async () => {
    const callModel = vi.fn(async () =>
      JSON.stringify({
        band: 'standard',
        tools: 'full',
        confident: true,
        reason: '需查信息',
      }),
    )
    const l2 = createL2Classifier({ callModel })
    const router = createHeuristicRouter({ l2 })
    const d = await router.route({ text: '查询一下今天北京的天气' })
    expect(shouldEscalateToL2(await createHeuristicRouter().route({ text: '查询一下今天北京的天气' }))).toBe(
      true,
    )
    expect(d.policy.tools).toBe('full')
    expect(d.band).toBe('standard')
    expect(d.reasons).toContain('l2_classifier')
    expect(callModel).toHaveBeenCalledOnce()
  })

  it('callModel 失败则保留 L1 并标记 l2_failed', async () => {
    const l2 = createL2Classifier({
      callModel: async () => {
        throw new Error('boom')
      },
    })
    const router = createHeuristicRouter({ l2 })
    const d = await router.route({ text: 'hello' })
    expect(d.band).toBe('unknown')
    expect(d.reasons).toContain('l2_failed')
  })

  it('寒暄不进 L2', async () => {
    const callModel = vi.fn(async () => '{}')
    const router = createHeuristicRouter({ l2: createL2Classifier({ callModel }) })
    const d = await router.route({ text: '你好' })
    expect(d.band).toBe('trivial')
    expect(callModel).not.toHaveBeenCalled()
  })
})
