/**
 * 短期记忆（working / short-term memory）数据结构。
 *
 * 定位：**会话内**的上下文窗口管理——解决「历史全量重放」导致的 token 线性膨胀、
 * 上下文溢出与 prompt 缓存击穿。跨会话的长期记忆（episodic / semantic）属 CP2，
 * 见 docs/design/03-记忆方案.md，不在本模块范围。
 */

/** 进短期记忆的消息视图；`id` 用作摘要游标，必须是稳定的（SQLite message id） */
export interface ShortTermMessage {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  /** 失败占位气泡：不进窗口也不进摘要（纯噪声） */
  failed?: boolean
}

/** 短期记忆运行时配置（缺省值即一期默认值） */
export interface ShortTermConfig {
  /** 近因窗口保留的 user+assistant 消息条数（不含摘要块与本轮消息） */
  activeMessages: number
  /** 窗口内单条消息的 token 上限，超出走头尾折叠 */
  maxMessageTokens: number
  /** 上下文总预算（摘要块 + 窗口），不含 system prompt 与本轮用户消息 */
  maxContextTokens: number
  /** 摘要块的 token 上限 */
  maxSummaryTokens: number
  /** 摘要正文的字符上限（喂给弱模型的输出约束 & 抽取式降级上限） */
  summaryMaxChars: number
  /** 窗口外累计多少条未摘要消息触发一次合并摘要 */
  summarizeEvery: number
  /** 摘要块是否作为 system 消息前置（命中 prompt 缓存的稳定前缀） */
  summaryAsSystemPrefix: boolean
}

export const DEFAULT_SHORT_TERM_CONFIG: ShortTermConfig = {
  activeMessages: 8,
  maxMessageTokens: 1_200,
  maxContextTokens: 6_000,
  maxSummaryTokens: 1_200,
  summaryMaxChars: 1_500,
  summarizeEvery: 6,
  summaryAsSystemPrefix: true,
}

export const SHORT_TERM_STATE_VERSION = 1 as const

/** 会话级短期记忆状态（落盘，随会话工作区一起删除） */
export interface ShortTermState {
  version: typeof SHORT_TERM_STATE_VERSION
  /** 已并入摘要的最后一条消息 id；找不到该 id 时视为游标失效，重新累积 */
  summarizedThroughId: string | null
  /** 已并入摘要的消息条数（可观测） */
  summarizedCount: number
  /** 摘要正文（紧凑条目，非逐字原文） */
  summary: string
  /** 摘要最近更新时间（Unix ms） */
  updatedAt: number
}

export function emptyShortTermState(now: number = Date.now()): ShortTermState {
  return {
    version: SHORT_TERM_STATE_VERSION,
    summarizedThroughId: null,
    summarizedCount: 0,
    summary: '',
    updatedAt: now,
  }
}

/** 计划结果：本轮真正进上下文的东西 + 供 consolidate 消费的待摘要消息 */
export interface ShortTermPlan {
  /** 需前置注入的摘要块（system 角色）；无摘要时为 undefined */
  summaryBlock?: { role: 'system'; content: string }
  /** 逐字进上下文的近因窗口（已按 token 预算裁剪） */
  active: ShortTermMessage[]
  /** 窗口外、尚未并入摘要的消息（按时间序） */
  pending: ShortTermMessage[]
  stats: {
    /** 会话内参与记忆的消息总数（已剔除 failed / system） */
    total: number
    activeCount: number
    pendingCount: number
    summarizedCount: number
    /** 摘要块 + 窗口的估算 token */
    estimatedTokens: number
    /** 本轮被折叠截断的窗口消息数 */
    truncatedCount: number
    /** 摘要游标是否命中（false = 状态与消息不一致，按未摘要处理） */
    cursorValid: boolean
  }
}
