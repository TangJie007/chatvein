import { describe, expect, it } from 'vitest'
import {
  buildSummarizePrompt,
  clampChars,
  consolidateShortTerm,
  emptyShortTermState,
  extractiveDigest,
  planShortTerm,
  renderSummaryBlock,
  type ShortTermMessage,
  type ShortTermState,
} from '../index'

function msg(id: string, role: 'user' | 'assistant', content: string): ShortTermMessage {
  return { id, role, content }
}

function conv(n: number, filler = '内容'): ShortTermMessage[] {
  const out: ShortTermMessage[] = []
  for (let i = 0; i < n; i++) {
    out.push(msg(`m${i}`, i % 2 === 0 ? 'user' : 'assistant', `${filler}-${i}`))
  }
  return out
}

describe('planShortTerm', () => {
  it('无状态、消息不多时全部进窗口', async () => {
    const plan = await planShortTerm({ messages: conv(4) })
    expect(plan.summaryBlock).toBeUndefined()
    expect(plan.active).toHaveLength(4)
    expect(plan.pending).toHaveLength(0)
    expect(plan.stats.summarizedCount).toBe(0)
  })

  it('超出窗口的旧消息进 pending，窗口只留最近 N 条', async () => {
    const plan = await planShortTerm({ messages: conv(12), config: { activeMessages: 8 } })
    expect(plan.active).toHaveLength(8)
    expect(plan.pending).toHaveLength(4)
    expect(plan.active[0]!.id).toBe('m4')
    expect(plan.active.at(-1)!.id).toBe('m11')
  })

  it('有摘要时：摘要块前置为 system，且窗口不含已摘要消息', async () => {
    const messages = conv(20)
    const state: ShortTermState = {
      ...emptyShortTermState(1),
      summarizedThroughId: 'm11',
      summarizedCount: 12,
      summary: '- 决定：用方案 A',
    }
    const plan = await planShortTerm({ messages, state, config: { activeMessages: 6 } })
    expect(plan.summaryBlock?.role).toBe('system')
    expect(plan.summaryBlock?.content).toContain('用方案 A')
    expect(plan.active).toHaveLength(6)
    expect(plan.active[0]!.id).toBe('m14')
    expect(plan.pending.map((m) => m.id)).toEqual(['m12', 'm13'])
    expect(plan.stats.summarizedCount).toBe(12)
    expect(plan.stats.cursorValid).toBe(true)
  })

  it('失败占位气泡不进窗口也不进摘要', async () => {
    const messages: ShortTermMessage[] = [
      msg('a', 'user', '你好'),
      { id: 'b', role: 'assistant', content: '抱歉，这次没能完成回复', failed: true },
      msg('c', 'user', '再问一次'),
    ]
    const plan = await planShortTerm({ messages })
    expect(plan.stats.total).toBe(2)
    expect(plan.active.map((m) => m.id)).toEqual(['a', 'c'])
  })

  it('总预算超限时收缩窗口（最少保留 2 条），被挤出的回到 pending', async () => {
    const long = '很长的历史消息内容'.repeat(200)
    const plan = await planShortTerm({
      messages: conv(10, long),
      config: { activeMessages: 8, maxContextTokens: 3_000 },
    })
    expect(plan.active.length).toBeGreaterThanOrEqual(2)
    expect(plan.stats.estimatedTokens).toBeLessThanOrEqual(3_000 + 1)
    expect(plan.stats.truncatedCount).toBeGreaterThan(0)
    expect(plan.active.length + plan.pending.length).toBe(10)
  })
})

describe('consolidateShortTerm', () => {
  it('待摘要消息不足 summarizeEvery 时不触发', async () => {
    const state = emptyShortTermState(1)
    const res = await consolidateShortTerm({ messages: conv(10), state, config: { activeMessages: 8 } })
    expect(res.consolidated).toBe(0)
    expect(res.state).toBe(state)
  })

  it('用注入的摘要器合并，并推进游标', async () => {
    const messages = conv(20)
    const summarizer = async () => '- 合并后的摘要'
    const res = await consolidateShortTerm({
      messages,
      state: emptyShortTermState(1),
      config: { activeMessages: 8, summarizeEvery: 4 },
      summarizer,
    })
    expect(res.consolidated).toBe(12)
    expect(res.viaModel).toBe(true)
    expect(res.state.summarizedThroughId).toBe('m11')
    expect(res.state.summarizedCount).toBe(12)
    expect(res.state.summary).toBe('- 合并后的摘要')
  })

  it('摘要器抛错时降级为抽取式摘要', async () => {
    const summarizer = async () => {
      throw new Error('model down')
    }
    const res = await consolidateShortTerm({
      messages: conv(20),
      state: emptyShortTermState(1),
      config: { activeMessages: 8, summarizeEvery: 4 },
      summarizer,
    })
    expect(res.viaModel).toBe(false)
    expect(res.state.summary.length).toBeGreaterThan(0)
    expect(res.state.summary).toContain('用户：')
  })

  it('未注入摘要器也能收敛（零模型降级路径）', async () => {
    const res = await consolidateShortTerm({
      messages: conv(20),
      config: { activeMessages: 8, summarizeEvery: 4 },
    })
    expect(res.consolidated).toBeGreaterThan(0)
    expect(res.state.summary.length).toBeGreaterThan(0)
  })

  it('二次 consolidate 幂等：窗口内消息不会被再次摘要', async () => {
    const messages = conv(20)
    const first = await consolidateShortTerm({
      messages,
      state: emptyShortTermState(1),
      config: { activeMessages: 8, summarizeEvery: 4 },
    })
    const second = await consolidateShortTerm({
      messages,
      state: first.state,
      config: { activeMessages: 8, summarizeEvery: 4 },
    })
    expect(second.consolidated).toBe(0)
    expect(second.state).toBe(first.state)
  })

  it('游标消息被删（retry 截断）时重新累积', async () => {
    const messages = conv(20)
    const state: ShortTermState = {
      ...emptyShortTermState(1),
      summarizedThroughId: 'gone',
      summarizedCount: 12,
      summary: '- 旧摘要',
    }
    const res = await consolidateShortTerm({
      messages,
      state,
      config: { activeMessages: 8, summarizeEvery: 4 },
      summarizer: async ({ previousSummary }) => `新|${previousSummary}`,
    })
    expect(res.consolidated).toBe(12)
    expect(res.state.summary.startsWith('新|')).toBe(true)
  })
})

describe('digest / prompt', () => {
  it('renderSummaryBlock 带固定标题；空摘要返回空串', () => {
    expect(renderSummaryBlock('')).toBe('')
    expect(renderSummaryBlock('- a')).toContain('会话前文摘要')
  })

  it('extractiveDigest 是确定性的', () => {
    const messages = conv(6)
    expect(extractiveDigest(messages)).toBe(extractiveDigest(messages))
  })

  it('clampChars 按字符上限折叠', () => {
    const text = Array.from({ length: 50 }, (_, i) => `条目-${i}`).join('\n')
    const out = clampChars(text, 120)
    expect(out.length).toBeLessThanOrEqual(120 + '…（摘要已折叠）…'.length + 2)
    expect(out).toContain('摘要已折叠')
  })

  it('buildSummarizePrompt 输出 system + user 两条', () => {
    const msgs = buildSummarizePrompt({
      previousSummary: '- 旧',
      messages: conv(4),
      maxChars: 800,
    })
    expect(msgs.map((m) => m.role)).toEqual(['system', 'user'])
    expect(msgs[1]!.content).toContain('【已有摘要】')
    expect(msgs[1]!.content).toContain('不超过 800 字')
  })
})
