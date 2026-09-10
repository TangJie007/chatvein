/**
 * L3 升级层单测（mock 模型；不依赖真实网络）。
 */
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import { describe, expect, it } from 'vitest'
import {
  buildL3Messages,
  classifyL3,
  describeTrigger,
  liftBand,
  liftLane,
  parseL3Judgement,
  resolveL3,
  type L3Decision,
} from '../l3'

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

const decision = (over: Partial<L3Decision> = {}): L3Decision => ({
  kind: 'decide',
  decidedBy: 'l3',
  lane: 'direct',
  domain: 'general',
  band: 'trivial',
  confidence: 0.9,
  ambiguous: false,
  query: { rewritten: 'x' },
  reason: 'test',
  ...over,
})

describe('parseL3Judgement', () => {
  it('归一化枚举', () => {
    const j = parseL3Judgement({
      lane: 'Agent',
      domain: 'CODING',
      band: 'Medium',
      confidence: 90,
      reason: '复核后仍判定为编码',
      rewritten: '修复类型报错',
    })
    expect(j.lane).toBe('agentic')
    expect(j.domain).toBe('code')
    expect(j.band).toBe('standard')
    expect(j.confidence).toBe(0.9)
  })

  it('非法枚举失败（不吞错）', () => {
    expect(() =>
      parseL3Judgement({
        lane: 'spaceship',
        domain: 'general',
        band: 'trivial',
        confidence: 1,
        rewritten: 'x',
      }),
    ).toThrow(/invalid_lane/)
  })

  it('空 reason 溯源为 l3', () => {
    const j = parseL3Judgement({
      lane: 'direct',
      domain: 'general',
      band: 'trivial',
      confidence: 1,
      rewritten: 'x',
    })
    expect(j.reason).toBe('l3')
  })
})

describe('describeTrigger', () => {
  it('safety flag 优先', () => {
    expect(
      describeTrigger({
        safety: { verdict: 'review', category: 'destructive' },
      }),
    ).toBe('safety-flag（destructive）')
  })

  it('多意图 > ambiguous > 低置信 > 无 prior', () => {
    const base = { text: '' } as const
    expect(describeTrigger({ ...base, prior: { intents: ['a', 'b'] } })).toBe('multi-intent')
    expect(describeTrigger({ ...base, prior: { ambiguous: true } })).toBe('ambiguous')
    expect(describeTrigger({ ...base, prior: { confidence: 0.4 } })).toBe('low-confidence')
    expect(describeTrigger({ ...base, prior: { confidence: 0.7 } })).toBe('upstream-grey')
    expect(describeTrigger({ ...base })).toBe('prior-unavailable')
  })
})

describe('buildL3Messages', () => {
  it('含前置判定与触发原因', () => {
    const [sys, user] = buildL3Messages({
      text: '把合同转成表格',
      prior: { lane: 'agentic', domain: 'general', confidence: 0.5 },
      safety: undefined,
    })
    const sysText = String(sys.content)
    const userText = String(user.content)
    expect(sysText).toContain('升级复审')
    expect(sysText).toContain('判别理由')
    expect(userText).toContain('low-confidence')
    expect(userText).toContain('前置判定')
    expect(userText).toContain('合同')
  })
})

describe('classifyL3', () => {
  it('无 model → unavailable（离线）', async () => {
    const r = await classifyL3('修一下类型')
    expect(r.kind).toBe('unavailable')
    if (r.kind === 'unavailable') expect(r.reason).toBe('no-model')
  })

  it('structured 成功 → decide（decidedBy=l3）', async () => {
    const model = structuredModel({
      lane: 'agentic',
      domain: 'code',
      band: 'standard',
      confidence: 0.91,
      ambiguous: false,
      reason: '复核：带文件路径且是命令句，编码单任务',
      rewritten: '修复 src/app.ts 类型报错',
      searchQuery: 'src/app.ts TypeScript error',
    })
    const r = await classifyL3(
      {
        text: '修一下 src/app.ts 的类型报错',
        prior: { decidedBy: 'l2', confidence: 0.5, ambiguous: true },
      },
      { model },
    )
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.decidedBy).toBe('l3')
      expect(r.lane).toBe('agentic')
      expect(r.domain).toBe('code')
      expect(r.confidence).toBeGreaterThan(0.8)
    }
  })

  it('structured 失败后文本 JSON 兜底', async () => {
    const model = structuredFailsThenText(
      '复核结论：仍是问答。\n{"lane":"direct","domain":"general","band":"simple","confidence":0.86,"reason":"概念问答","rewritten":"解释闭包"}',
    )
    const r = await classifyL3('闭包是什么', { model })
    expect(r.kind).toBe('decide')
    if (r.kind === 'decide') {
      expect(r.lane).toBe('direct')
      expect(r.decidedBy).toBe('l3')
    }
  })

  it('调用失败 → unavailable，不抛错', async () => {
    const r = await classifyL3('随便', { model: failingModel() })
    expect(r.kind).toBe('unavailable')
  })
})

describe('liftLane / liftBand', () => {
  it('direct→agentic→orchestrated 到顶封顶', () => {
    expect(liftLane('direct')).toBe('agentic')
    expect(liftLane('agentic')).toBe('orchestrated')
    expect(liftLane('orchestrated')).toBe('orchestrated')
  })

  it('band 逐档抬升', () => {
    expect(liftBand('trivial')).toBe('simple')
    expect(liftBand('simple')).toBe('standard')
    expect(liftBand('complex')).toBe('complex')
  })
})

describe('resolveL3（§8/§9 收口）', () => {
  it('带 clarification → clarify，保留模型候选', () => {
    const r = resolveL3(
      decision({
        confidence: 0.4,
        clarification: { question: '处理哪个文件？', options: ['合同.pdf'] },
      }),
    )
    expect(r.kind).toBe('clarify')
    if (r.kind === 'clarify') expect(r.decision.clarification?.options).toContain('合同.pdf')
  })

  it('confidence ≥ accept → adopt 原样', () => {
    const r = resolveL3(decision({ confidence: 0.9 }))
    expect(r.kind).toBe('adopt')
    if (r.kind === 'adopt') {
      expect(r.decision.ambiguous).toBe(false)
      expect(r.decision.lane).toBe('direct')
    }
  })

  it('escalate~accept → adopt 但标 ambiguous', () => {
    const r = resolveL3(decision({ confidence: 0.7 }))
    expect(r.kind).toBe('adopt')
    if (r.kind === 'adopt') expect(r.decision.ambiguous).toBe(true)
  })

  it('escalate~accept 且 direct+非 general → 抬到 agentic', () => {
    const r = resolveL3(decision({ lane: 'direct', domain: 'code', confidence: 0.7 }))
    expect(r.kind).toBe('adopt')
    if (r.kind === 'adopt') {
      expect(r.decision.lane).toBe('agentic')
      expect(r.decision.ambiguous).toBe(true)
    }
  })

  it('仍 < escalate 且无澄清 → lift 抬一档采纳', () => {
    const r = resolveL3(decision({ lane: 'direct', band: 'trivial', confidence: 0.4 }))
    expect(r.kind).toBe('lift')
    if (r.kind === 'lift') {
      expect(r.decision.lane).toBe('agentic')
      expect(r.decision.band).toBe('standard')
      expect(r.decision.ambiguous).toBe(true)
      expect(r.decision.reason).toContain('抬一档')
    }
  })

  it('阈值可覆盖', () => {
    const r = resolveL3(decision({ confidence: 0.55 }), { escalate: 0.5, accept: 0.85 })
    expect(r.kind).toBe('adopt')
  })
})
