/**
 * L3 升级层：强模型 · 推理重判。
 *
 * 设计：docs/分层路由与预算决策.md §4.4
 * 触发（编排层判定后调用）：低置信 / ambiguous / 多意图需串联 / 安全 flag。
 *
 * 目录职责：
 * - types.ts   入参 / 出参 / 阈值常量
 * - schema.ts  schema + 归一（复用 L2 词表）
 * - prompt.ts  L2 词表 + 升级复审 / 前置判定 / 轻量 CoT
 * - invoke.ts  withStructuredOutput → 文本 JSON；失败不重试
 * - resolve.ts §8/§9 收口（adopt / clarify / lift，纯函数）
 * - index.ts   classifyL3 / runL3 编排 + 离线降级出口
 */
import { describeTrigger, buildL3Messages } from './prompt'
import { invokeL3 } from './invoke'
import {
  L3_DEFAULT_MAX_TOKENS,
  L3_DEFAULT_TIMEOUT_MS,
  type L3Decision,
  type L3Input,
  type L3Judgement,
  type L3Options,
  type L3Result,
  type L3Unavailable,
} from './types'

export {
  describeTrigger,
  buildL3Messages,
  SYSTEM_PROMPT,
  type BuildL3MessagesOptions,
} from './prompt'
export { invokeL3, type InvokeL3Options } from './invoke'
export { L3RawSchema, parseL3Judgement } from './schema'
export {
  liftBand,
  liftLane,
  resolveL3,
  type L3Resolution,
} from './resolve'
export {
  L3_DEFAULT_ACCEPT,
  L3_DEFAULT_ESCALATE,
  L3_DEFAULT_MAX_TOKENS,
  L3_DEFAULT_TIMEOUT_MS,
  L3_PROMPT_VERSION,
  type L3Attachment,
  type L3Decision,
  type L3HistoryTurn,
  type L3Input,
  type L3Judgement,
  type L3Options,
  type L3Prior,
  type L3Result,
  type L3Thresholds,
  type L3Unavailable,
} from './types'

function toDecision(j: L3Judgement, slots?: Record<string, unknown>): L3Decision {
  return {
    kind: 'decide',
    decidedBy: 'l3',
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

function unavailable(reason: string): L3Unavailable {
  return { kind: 'unavailable', reason }
}

function slotsFromInput(input: L3Input): Record<string, unknown> | undefined {
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
 * 调 L3：单次强模型推理重判。
 *
 * - 无 model → unavailable（离线降级出口）
 * - 超时 / 解析 / 调用失败 → unavailable，**不重试**
 * - 成功 → decide（decidedBy=l3）
 *
 * 后续收口（仍低置信 → clarify / lift）由编排层调 resolveL3 完成。
 */
export async function classifyL3(
  input: L3Input | string,
  options: L3Options = {},
): Promise<L3Result> {
  const normalized: L3Input = typeof input === 'string' ? { text: input } : input

  if (!options.model) {
    return unavailable('no-model')
  }

  const messages = buildL3Messages({
    text: normalized.text,
    history: normalized.history,
    attachments: normalized.attachments,
    facts: normalized.facts,
    prior: normalized.prior,
    safety: normalized.safety,
    trigger: describeTrigger(normalized),
  })

  const judgement = await invokeL3({
    model: options.model,
    messages,
    temperature: options.temperature ?? 0,
    maxTokens: L3_DEFAULT_MAX_TOKENS,
    timeoutMs: options.timeoutMs ?? L3_DEFAULT_TIMEOUT_MS,
    signal: options.signal,
  })

  if (!judgement) return unavailable('invoke-or-parse-failed')
  return toDecision(judgement, slotsFromInput(normalized))
}

/** @deprecated 使用 classifyL3；保留别名便于编排层统一命名 */
export const runL3 = classifyL3
