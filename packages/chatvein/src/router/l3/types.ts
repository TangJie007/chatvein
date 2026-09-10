/**
 * L3 升级层类型：强模型 · 推理 · 重判的入参 / 出参。
 *
 * 设计：docs/分层路由与预算决策.md §4.4（触发）与 §8 / §9（收口语义）。
 * 与 L2 共用同一份词表与输出 schema（l3/schema 直接复用 l2），
 * 因此 L3Judgement 与 L2Judgement 同构，仅多了「前置判定 / 安全上下文」输入。
 */
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { Facts } from '../l1/types'
import type { Band, Domain, Lane, SafetyResult } from '../types'

export type { Facts, Band, Domain, Lane }

export interface L3Attachment {
  name: string
  mime?: string
}

export interface L3HistoryTurn {
  role: string
  content: string
}

/** 触发升级的前一层判定（L1/L2 产物），供强模复核对照 */
export interface L3Prior {
  decidedBy?: string
  lane?: Lane
  domain?: Domain
  band?: Band
  confidence?: number
  ambiguous?: boolean
  reason?: string
  intents?: string[]
  clarification?: { question: string; options?: string[] }
}

export interface L3Input {
  text: string
  history?: L3HistoryTurn[]
  attachments?: L3Attachment[]
  /** L1 已抽取事实（可选；写入 prompt 辅助判别） */
  facts?: Facts
  /** 触发升级的前一层判定；有则要求模型逐项复核 */
  prior?: L3Prior
  /** 安全护栏结果：review（flag，本地破坏性/凭据/外发）时需抬档重判 */
  safety?: Pick<SafetyResult, 'verdict' | 'category' | 'ruleId' | 'reason'>
}

/** 强模型结构化输出（校验 + 枚举归一后）。字段与 L2Judgement 对齐 */
export interface L3Judgement {
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

export interface L3Decision {
  kind: 'decide'
  decidedBy: 'l3'
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

/** 无 model / 超时 / 解析失败 —— 由编排层抬档采纳或落兜底 */
export interface L3Unavailable {
  kind: 'unavailable'
  reason: string
}

export type L3Result = L3Decision | L3Unavailable

export interface L3Options {
  /** L3 强模型；未注入 = 离线，直接 unavailable */
  model?: LanguageModelLike
  /** 默认 0 */
  temperature?: number
  /** 超时 ms，默认 8000（设计 §13：L1/L2/L3 = 50ms/2s/8s） */
  timeoutMs?: number
  signal?: AbortSignal
  /** 审计 / prompt 版本 */
  promptVersion?: string
}

/** §8 阈值（默认 accept 0.85 / escalate 0.6，可覆盖） */
export interface L3Thresholds {
  accept?: number
  escalate?: number
}

export const L3_PROMPT_VERSION = 'l3-v1'
export const L3_DEFAULT_TIMEOUT_MS = 8_000
/** 包内输出上限（比 L2 宽松），不对外配置 */
export const L3_DEFAULT_MAX_TOKENS = 800
export const L3_DEFAULT_ACCEPT = 0.85
export const L3_DEFAULT_ESCALATE = 0.6
