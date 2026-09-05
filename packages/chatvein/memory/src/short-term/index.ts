/**
 * 短期记忆（会话内工作记忆）：近因窗口 + 滚动摘要 + token 预算。
 * 设计见 docs/design/14-短期记忆方案.md。
 */
export {
  DEFAULT_SHORT_TERM_CONFIG,
  SHORT_TERM_STATE_VERSION,
  emptyShortTermState,
  type ShortTermConfig,
  type ShortTermMessage,
  type ShortTermPlan,
  type ShortTermState,
} from './types'

export {
  planShortTerm,
  splitByWindow,
  cursorIndex,
  memoryMessages,
  type PlanShortTermInput,
} from './plan'

export {
  consolidateShortTerm,
  type ConsolidateShortTermInput,
  type ConsolidateShortTermResult,
  type ShortTermSummarizer,
  type SummarizeInput,
} from './consolidate'

export {
  SUMMARY_BLOCK_TITLE,
  clampChars,
  compactText,
  composeExtractive,
  extractiveDigest,
  renderSummaryBlock,
  type DigestOptions,
} from './digest'

export {
  SUMMARIZE_PER_MESSAGE_CHARS,
  buildSummarizePrompt,
  type SummarizePromptMessage,
} from './prompt'
