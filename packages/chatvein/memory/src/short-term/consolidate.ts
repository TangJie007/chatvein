/**
 * 短期记忆的「写」路径：把挤出近因窗口的旧消息合并进滚动摘要。
 *
 * 对应 design/03 §3.2：异步、批处理、弱模型、可降级。
 * 摘要器由调用方注入（app 用 weak 档模型），缺失或失败时降级为抽取式摘要，
 * 保证「关掉模型也能收敛」。
 */
import {
  DEFAULT_SHORT_TERM_CONFIG,
  emptyShortTermState,
  type ShortTermConfig,
  type ShortTermMessage,
  type ShortTermState,
} from './types'
import { memoryMessages, splitByWindow } from './plan'
import { clampChars, composeExtractive } from './digest'

export interface SummarizeInput {
  /** 已有摘要（首次为空串） */
  previousSummary: string
  /** 本次要并入的消息（按时间序） */
  messages: ShortTermMessage[]
  /** 输出字符上限 */
  maxChars: number
}

/** 摘要器：返回合并后的新摘要正文；抛错或返回空 → 降级 */
export type ShortTermSummarizer = (input: SummarizeInput) => Promise<string>

export interface ConsolidateShortTermInput {
  /** 会话全量消息（按时间序，可含本轮新追加的一问一答） */
  messages: ReadonlyArray<ShortTermMessage>
  state?: ShortTermState | null
  config?: Partial<ShortTermConfig>
  summarizer?: ShortTermSummarizer
  now?: number
}

export interface ConsolidateShortTermResult {
  state: ShortTermState
  /** 本次并入摘要的消息数；0 = 未触发（待摘要消息不足 summarizeEvery） */
  consolidated: number
  /** true = 走了模型摘要；false = 抽取式降级 */
  viaModel: boolean
}

export async function consolidateShortTerm(
  input: ConsolidateShortTermInput,
): Promise<ConsolidateShortTermResult> {
  const cfg: ShortTermConfig = { ...DEFAULT_SHORT_TERM_CONFIG, ...input.config }
  const all = memoryMessages(input.messages)
  const { pending } = splitByWindow(all, input.state?.summarizedThroughId, cfg.activeMessages)

  if (pending.length < cfg.summarizeEvery) {
    return {
      state: input.state ?? emptyShortTermState(input.now),
      consolidated: 0,
      viaModel: false,
    }
  }

  const previous = (input.state?.summary ?? '').trim()
  const maxChars = cfg.summaryMaxChars

  let summary = ''
  let viaModel = false
  if (input.summarizer) {
    try {
      const out = await input.summarizer({ previousSummary: previous, messages: pending, maxChars })
      const text = (out ?? '').trim()
      if (text) {
        summary = clampChars(text, maxChars)
        viaModel = true
      }
    } catch {
      // 降级：摘要失败不应影响主对话，下面走抽取式
    }
  }
  if (!summary) {
    summary = composeExtractive(previous, pending, maxChars)
  }

  const last = pending[pending.length - 1]!
  const cursor = all.findIndex((m) => m.id === last.id)
  return {
    state: {
      version: 1,
      summarizedThroughId: last.id,
      summarizedCount: cursor + 1,
      summary,
      updatedAt: input.now ?? Date.now(),
    },
    consolidated: pending.length,
    viaModel,
  }
}
