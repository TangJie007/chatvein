/**
 * L2 类型：弱模结构化分类的入参 / 出参。
 *
 * 设计：docs/分层路由与预算决策.md §4.3
 */
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { Band, Domain, Lane } from '../types'
import type { Facts } from '../l1/types'

export type { Band, Domain, Lane }

export interface L2Attachment {
  name: string
  mime?: string
}

export interface L2HistoryTurn {
  role: string
  content: string
}

export interface L2Input {
  text: string
  history?: L2HistoryTurn[]
  attachments?: L2Attachment[]
  /** L1 已抽取的事实（可选；有则写入 prompt 辅助判别） */
  facts?: Facts
}

/** 模型结构化输出（校验 + 枚举归一后） */
export interface L2Judgement {
  lane: Lane
  domain: Domain
  band: Band
  confidence: number
  ambiguous: boolean
  reason: string
  rewritten: string
  searchQuery?: string
  intents?: string[]
  clarification?: { question: string; options?: string[] }
}

export interface L2Decision {
  kind: 'decide'
  decidedBy: 'l2'
  lane: Lane
  domain: Domain
  band: Band
  confidence: number
  ambiguous: boolean
  query: {
    rewritten: string
    searchQuery?: string
    slots?: Record<string, unknown>
    intents?: string[]
  }
  reason: string
  clarification?: { question: string; options?: string[] }
}

/** 离线 / 无模型 / 超时 / 解析失败 —— 交上层降级 L1 或兜底 */
export interface L2Unavailable {
  kind: 'unavailable'
  reason: string
}

export type L2Result = L2Decision | L2Unavailable

export interface L2Options {
  /** L2 弱模型；未注入 = 离线，直接 unavailable */
  model?: LanguageModelLike
  /** 默认 0 */
  temperature?: number
  /** 小输出预算，默认 400 */
  maxTokens?: number
  /** 超时 ms，默认 2000（设计 §13） */
  timeoutMs?: number
  signal?: AbortSignal
  /** 写入 meta / 审计；变更即让旧缓存失效 */
  promptVersion?: string
}

export const L2_PROMPT_VERSION = 'l2-v1'
export const L2_DEFAULT_TIMEOUT_MS = 2_000
export const L2_DEFAULT_MAX_TOKENS = 400
