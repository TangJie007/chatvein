/**
 * 短期记忆的「读」路径：把全量会话历史裁剪成
 * `摘要块（稳定前缀） + 近因窗口（逐字）` 两段，受 token 预算约束。
 *
 * 布局刻意对齐 design/03 §5：越稳定越靠前。摘要块只在摘要真正更新时才变，
 * 易变的近因窗口与本轮消息放在最后，不击穿前面的缓存。
 */
import { AIMessage, HumanMessage, trimMessages, type BaseMessage } from '@langchain/core/messages'
import { TOKENS_PER_MESSAGE, estimateTextTokens, truncateFolded } from '@chatvein/context'
import { renderSummaryBlock } from './digest'
import {
  DEFAULT_SHORT_TERM_CONFIG,
  type ShortTermConfig,
  type ShortTermMessage,
  type ShortTermPlan,
  type ShortTermState,
} from './types'

export interface PlanShortTermInput {
  /** 会话全量消息（按时间序；不含本轮用户消息） */
  messages: ReadonlyArray<ShortTermMessage>
  /** 上轮落盘的短期记忆状态；无则视为全新会话 */
  state?: ShortTermState | null
  config?: Partial<ShortTermConfig>
  /** 给本轮用户消息预留的 token */
  reserveTokens?: number
}

/** 参与短期记忆的消息：只留 user/assistant，剔除失败占位 */
export function memoryMessages(
  messages: ReadonlyArray<ShortTermMessage>,
): ShortTermMessage[] {
  return (messages ?? []).filter(
    (m) => m && (m.role === 'user' || m.role === 'assistant') && !m.failed,
  )
}

/** 摘要游标在消息序列中的位置；找不到 = -1（游标失效） */
export function cursorIndex(
  messages: ReadonlyArray<ShortTermMessage>,
  summarizedThroughId: string | null | undefined,
): number {
  if (!summarizedThroughId) return -1
  return messages.findIndex((m) => m.id === summarizedThroughId)
}

/** 按当前状态切分：已摘要 / 待摘要 / 近因窗口 */
export function splitByWindow(
  messages: ReadonlyArray<ShortTermMessage>,
  summarizedThroughId: string | null | undefined,
  activeMessages: number,
): { pending: ShortTermMessage[]; active: ShortTermMessage[]; cursorValid: boolean } {
  const cursor = cursorIndex(messages, summarizedThroughId)
  const unsummarized = messages.slice(cursor + 1)
  const activeCount = Math.max(0, Math.min(activeMessages, unsummarized.length))
  const cut = unsummarized.length - activeCount
  return {
    pending: unsummarized.slice(0, cut),
    active: unsummarized.slice(cut),
    cursorValid: cursor >= 0 || !summarizedThroughId,
  }
}

/**
 * 计算本轮进上下文的内容。
 *
 * 预算收缩顺序（保证「宁可少、不可爆」）：
 * 1. 摘要块超过 `maxSummaryTokens` → 折叠
 * 2. 窗口内单条超过 `maxMessageTokens` → 折叠
 * 3. 仍超总预算 → 从窗口最老的一条开始往外挤（最少保留 2 条，即最近一问一答）
 */
export async function planShortTerm(input: PlanShortTermInput): Promise<ShortTermPlan> {
  const cfg: ShortTermConfig = { ...DEFAULT_SHORT_TERM_CONFIG, ...input.config }
  const all = memoryMessages(input.messages)
  const { pending, active: rawActive, cursorValid } = splitByWindow(
    all,
    input.state?.summarizedThroughId,
    cfg.activeMessages,
  )

  const budget = Math.max(200, cfg.maxContextTokens - Math.max(0, input.reserveTokens ?? 0))

  // 1) 摘要块
  let summaryText = renderSummaryBlock(input.state?.summary ?? '')
  if (summaryText && estimateTextTokens(summaryText) > cfg.maxSummaryTokens) {
    summaryText = truncateFolded(summaryText, cfg.maxSummaryTokens).text
  }
  const summaryTokens = summaryText ? estimateTextTokens(summaryText) + TOKENS_PER_MESSAGE : 0

  // 2) 窗口内单条截断
  let truncatedCount = 0
  let active: ShortTermMessage[] = rawActive.map((m) => {
    if (estimateTextTokens(m.content) <= cfg.maxMessageTokens) return m
    truncatedCount += 1
    return { ...m, content: truncateFolded(m.content, cfg.maxMessageTokens).text }
  })

  // 3) 总预算收缩：交给 LangChain trimMessages（保留最新、丢弃最老，strategy: 'last'）
  //    与「从最老往外挤」语义一致；摘要块 / 单条折叠 / 工具对回捞仍由本模块自研
  //    （LangChain 无对应能力）。详见 docs/design/14-短期记忆方案.md。
  if (active.length > 2) {
    const kept = await trimActiveToBudget(active, budget, summaryTokens)
    const keptIds = new Set(kept.map((m) => m.id))
    const dropped = active.filter((m) => !keptIds.has(m.id))
    if (dropped.length) pending.push(...dropped)
    active = kept
  }

  const stats: ShortTermPlan['stats'] = {
    total: all.length,
    activeCount: active.length,
    pendingCount: pending.length,
    summarizedCount: all.length - pending.length - active.length,
    estimatedTokens: summaryTokens + active.reduce((n, m) => n + estimateTextTokens(m.content) + TOKENS_PER_MESSAGE, 0),
    truncatedCount,
    cursorValid,
  }

  const plan: ShortTermPlan = { active, pending, stats }
  if (summaryText && cfg.summaryAsSystemPrefix) {
    plan.summaryBlock = { role: 'system', content: summaryText }
  }
  return plan
}

/**
 * 用 LangChain `trimMessages` 做「历史数组」的 token 预算裁剪：保留最新的若干条、
 * 丢弃最老的（strategy: 'last'），与「从最老往外挤」语义一致。单条 token 估算复用
 * `@chatvein/context` 的 `estimateTextTokens`，行为与原自研收缩对齐。
 *
 * 这是短期记忆「裁剪」层对 LangChain 的结合点。注意 `trimMessages` 只裁剪、不摘要，
 * 因此摘要块（summaryBlock）、窗口内单条折叠（truncateFolded）、工具对回捞、SWR 降级
 * 仍由本模块自研——LangChain 没有这些能力。
 */
async function trimActiveToBudget(
  active: ShortTermMessage[],
  budget: number,
  reservedSummaryTokens: number,
): Promise<ShortTermMessage[]> {
  if (active.length <= 2) return active
  const available = Math.max(1, Math.floor(budget - reservedSummaryTokens))
  const lc: BaseMessage[] = active.map((m) =>
    m.role === 'assistant'
      ? new AIMessage({ content: m.content, id: m.id })
      : new HumanMessage({ content: m.content, id: m.id }),
  )
  const trimmed = await trimMessages(lc, {
    maxTokens: available,
    tokenCounter: (msgs) =>
      msgs.reduce(
        (n, m) => n + estimateTextTokens(typeof m.content === 'string' ? m.content : ''),
        0,
      ),
    strategy: 'last',
    includeSystem: true,
    allowPartial: false,
  })
  const keepIds = new Set(trimmed.map((m) => m.id))
  let out = active.filter((m) => keepIds.has(m.id))
  // 保底：至少保留最近 2 条（一问一答），与原自研收缩语义一致
  if (out.length < 2 && active.length >= 2) out = active.slice(-2)
  return out
}
