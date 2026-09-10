/**
 * L2 主分类层：弱模型 · 结构化输出（主力）。
 *
 * 设计：docs/分层路由与预算决策.md §4.3
 *
 * 目录职责：
 * - types.ts    入参 / 出参 / 常量
 * - schema.ts   zod 校验 + 枚举归一
 * - fewshot.ts  每类 2~3 条示范
 * - history.ts  历史摘要（控 token）
 * - prompt.ts   角色 / 词汇表 / few-shot / schema 拼装
 * - invoke.ts   withStructuredOutput → 文本 JSON；失败不重试
 * - index.ts    classifyL2 / runL2 编排 + 离线降级出口
 */
import { deriveBudget } from '../l0/budget'
import type { Band, ModelTier, ToolsPolicy } from '../types'
import { invokeL2 } from './invoke'
import { buildL2Messages } from './prompt'
import {
  L2_DEFAULT_MAX_TOKENS,
  L2_DEFAULT_TIMEOUT_MS,
  type L2Decision,
  type L2Input,
  type L2Judgement,
  type L2Options,
  type L2Result,
  type L2Unavailable,
} from './types'

export type {
  L2Attachment,
  L2Decision,
  L2HistoryTurn,
  L2Input,
  L2Judgement,
  L2Options,
  L2Result,
  L2Unavailable,
} from './types'

export {
  L2_DEFAULT_MAX_TOKENS,
  L2_DEFAULT_TIMEOUT_MS,
  L2_PROMPT_VERSION,
} from './types'

export { L2RawSchema, parseL2Judgement } from './schema'
export { L2_FEW_SHOTS } from './fewshot'
export { summarizeHistory } from './history'
export { buildL2Messages, SYSTEM_PROMPT } from './prompt'
export { invokeL2 } from './invoke'

export type { Band, ModelTier, ToolsPolicy } from '../types'
/** @deprecated 使用 ModelTier */
export type { ModelStrength } from '../types'

/** 由 band 派生策略摘要（兼容旧 API；完整预算见 deriveBudget） */
export function policyForBand(band: Band): {
  modelTier: ModelTier
  tools: ToolsPolicy
  maxSteps: number
} {
  const b = deriveBudget(band)
  return {
    modelTier: b.modelTier,
    tools: b.toolsPolicy,
    maxSteps: b.maxSteps,
  }
}

function toDecision(j: L2Judgement, slots?: Record<string, unknown>): L2Decision {
  return {
    kind: 'decide',
    decidedBy: 'l2',
    lane: j.lane,
    domain: j.domain,
    band: j.band,
    confidence: j.confidence,
    ambiguous: j.ambiguous,
    query: {
      rewritten: j.rewritten,
      searchQuery: j.searchQuery,
      slots: slots && Object.keys(slots).length ? slots : undefined,
      intents: j.intents,
    },
    reason: j.reason,
    clarification: j.clarification,
  }
}

function unavailable(reason: string): L2Unavailable {
  return { kind: 'unavailable', reason }
}

function slotsFromInput(input: L2Input): Record<string, unknown> | undefined {
  const slots: Record<string, unknown> = {}
  const paths = input.facts?.files.paths
  if (paths?.length) slots.paths = paths
  const refs = input.facts?.code.pathWithLine
  if (refs?.length) slots.codeRefs = refs
  const exts = input.facts?.files.extensions
  if (exts?.length) slots.extensions = exts
  if (input.attachments?.length) {
    slots.attachments = input.attachments.map((a) => a.name)
  }
  return Object.keys(slots).length ? slots : undefined
}

/**
 * 调 L2：单次结构化分类。
 *
 * - 无 model → unavailable（离线降级出口）
 * - 超时 / 解析 / 调用失败 → unavailable，**不重试**
 * - 成功 → decide（decidedBy=l2）
 */
export async function classifyL2(
  input: L2Input | string,
  options: L2Options = {},
): Promise<L2Result> {
  const normalized: L2Input = typeof input === 'string' ? { text: input } : input

  if (!options.model) {
    return unavailable('no-model')
  }

  const messages = buildL2Messages({
    text: normalized.text,
    history: normalized.history,
    attachments: normalized.attachments,
    facts: normalized.facts,
  })

  const judgement = await invokeL2({
    model: options.model,
    messages,
    temperature: options.temperature ?? 0,
    maxTokens: L2_DEFAULT_MAX_TOKENS,
    timeoutMs: options.timeoutMs ?? L2_DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  })

  if (!judgement) return unavailable('invoke-or-parse-failed')
  return toDecision(judgement, slotsFromInput(normalized))
}

/** @deprecated 使用 classifyL2；保留别名便于编排层统一命名 */
export const runL2 = classifyL2
