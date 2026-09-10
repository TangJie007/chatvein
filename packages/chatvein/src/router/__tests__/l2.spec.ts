/**
 * L2 主分类层单测（mock 模型；不依赖真实网络）。
 */
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import { describe, expect, it } from 'vitest'
import {
  classifyL2,
  parseL2Judgement,
  policyForBand,
  summarizeHistory,
  L2_FEW_SHOTS,
} from '../l2'
import { extractFacts } from '../l1'

function structuredModel(payload: unknown): LanguageModelLike {
  return {
    withStructuredOutput: () => ({
      invoke: async () => payload,
    }),
  } as unknown as LanguageModelLike
}

function textModel(content: string): LanguageModelLike {
  return {
    invoke: async () => ({ content }),
  } as unknown as LanguageModelLike
}

function structuredFailsThenText(content: string): LanguageModelLike {
  return {
    withStructuredOutput: () => ({
      invoke: async () => {
        throw new Error('structured_unsupported')
      },
    }),
    invoke: async () => ({ content }),
  } as unknown as LanguageModelLike
}

function failingModel(): LanguageModelLike {
  return {
    withStructuredOutput: () => ({
      invoke: async () => {
        throw new Error('boom')
      },
    }),
    invoke: async () => {
      throw new Error('boom')
    },
  } as unknown as LanguageModelLike
}

describe('parseL2Judgement', () => {
  it('schema + 枚举归一', () => {
    const j = parseL2Judgement({
      lane: 'Agent',
      domain: 'CODING',
      band: 'Medium',
      confidence: 90,
      reason: '单点修 bug',
      rewritten: '修复类型错误',
    })
    expect(j.lane).toBe('agentic')
    expect(j.domain).toBe('code')
    expect(j.band).toBe('standard')
    expect(j.confidence).toBe(0.9)
  })

  it('非法枚举失败（不吞错）', () => {
    expect(() =>
      parseL2Judgement({
        lane: 'spaceship',
        domain: 'general',
        band: 'trivial',
        confidence: 1,
        rewritten: 'x',
      }),
    ).toThrow(/invalid_lane/)
  })
})

describe('policyForBand', () => {
  it('band → 预算摘要对齐 deriveBudget', () => {
    expect(policyForBand('trivial')).toMatchObject({
      modelTier: 'weak',
      tools: 'none',
      maxSteps: 4,
    })
    expect(policyForBand('complex').modelTier).toBe('strong')
  })
})

describe('summarizeHistory', () => {
  it('无历史', () => {
    expect(summarizeHistory(undefined)).toBe('（无）')
  })

  it('截断最近轮次', () => {
    const s = summarizeHistory(
      [
        { role: 'user', content: 'a'.repeat(300) },
        { role: 'assistant', content: 'ok' },
      ],
      { maxCharsPerTurn: 40 },
    )
    expect(s).toContain('[user]')
    expect(s).toContain('…')
    expect(s).toContain('[assistant] ok')
  })
})

describe('classifyL2', () => {
  it('无 model → unavailable（离线）', async () => {
    const r = await classifyL2('修一下类型')
    expect(r.kind).toBe('unavailable')
    if (r.kind === 'unavailable') expect(r.reason).toBe('no-model')
  })

  it('structured 成功 → decide', async () => {
    const model = structuredModel({
      lane: 'agentic',
      domain: 'code',
      band: 'standard',
      confidence: 0.91,
      ambiguous: false,
      reason: '单点修 bug',
      rewritten: '修复 src/app.ts 类型报错',
      searchQuery: 'src/app.ts TypeScript error',
    })
    const r = await classifyL2(
      {
        text: '修一下 src/app.ts 的类型报错',
        facts: extractFacts('修一下 src/app.ts 的类型报错'),
      },
      { model },
    )
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.decidedBy).toBe('l2')
      expect(r.lane).toBe('agentic')
      expect(r.domain).toBe('code')
      expect(r.query.rewritten).toContain('类型')
      expect(r.confidence).toBeGreaterThan(0.8)
    }
  })

  it('structured 失败后文本 JSON 兜底', async () => {
    const model = structuredFailsThenText(
      '废话 {"lane":"direct","domain":"general","band":"simple","confidence":0.86,"reason":"概念","rewritten":"解释闭包"} 尾',
    )
    const r = await classifyL2('闭包是什么', { model })
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.lane).toBe('direct')
      expect(r.domain).toBe('general')
    }
  })

  it('调用失败 → unavailable，不抛错', async () => {
    const r = await classifyL2('随便', { model: failingModel() })
    expect(r.kind).toBe('unavailable')
  })

  it('纯文本模型路径', async () => {
    const model = textModel(
      JSON.stringify({
        lane: 'orchestrated',
        domain: 'general',
        band: 'complex',
        confidence: 0.88,
        reason: '多步骤文档',
        rewritten: '解析合同并导出对照表',
        intents: ['解析', '导出'],
      }),
    )
    const r = await classifyL2('先解析合同再导出', { model })
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.lane).toBe('orchestrated')
      expect(r.domain).toBe('general')
      expect(r.query.intents?.length).toBeGreaterThan(0)
    }
  })
})

describe('few-shot 覆盖', () => {
  it('每类至少 2 条', () => {
    const counts = new Map<string, number>()
    for (const ex of L2_FEW_SHOTS) {
      const k = `${ex.expect.lane}|${ex.expect.domain}`
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    for (const [, n] of counts) expect(n).toBeGreaterThanOrEqual(2)
    expect(counts.size).toBeGreaterThanOrEqual(5)
  })
})
