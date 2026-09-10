/**
 * L3 Prompt：在 L2 词表之上做「升级复审」。
 *
 * 复用 L2 的 SYSTEM_PROMPT / few-shot / 历史摘要 / 附件与特征格式，
 * 只附加：① 升级触发说明；② 前置判定供复核；③ 先给判别理由再下结论（轻量 CoT）。
 */
import { HumanMessage, SystemMessage, type BaseMessage } from '@langchain/core/messages'
import { truncate } from 'es-toolkit/compat'
import { summarizeHistory } from '../l2/history'
import {
  formatAttachments,
  formatFacts,
  formatFewShots,
  SYSTEM_PROMPT as L2_SYSTEM_PROMPT,
} from '../l2/prompt'
import type { L3Input, L3Prior } from './types'

const UPGRADE_TAIL = `## 本次是升级复审（L3）
仅当前置判定置信不足 / 模糊 / 多意图 / 涉安全护栏时调用。逐项复核后仍输出唯一 JSON 对象：
- 先给**判别理由**再下结论（轻量 CoT）：在 reason 里写明依据哪类信号判出 lane/domain/band；与前一层不同时点出分歧。
- 不盲从前置判定，也不为「显专业」而盲目抬档——证据不足就如实低置信。
- 多意图需串联 → orchestrated 且填 intents；信息不足 → 填 clarification + 候选（可带 options），lane 暂置 direct、confidence 压低。
- 若触发源自安全 flag：保持 domain 判准（下游走审批），不把普通对话误抬成高风险任务。
- 其余词汇表、few-shot 判法与 L2 一致。`

export const SYSTEM_PROMPT = `${L2_SYSTEM_PROMPT}\n\n${UPGRADE_TAIL}`

/** 触发原因（写进 prompt + reason 溯源），供审计与调试 */
export function describeTrigger(input: Pick<L3Input, 'prior' | 'safety'>): string {
  const safety = input.safety
  if (safety?.verdict === 'review') {
    return `safety-flag（${safety.category ?? 'unknown'}）`
  }
  const p = input.prior
  if (!p) return 'prior-unavailable'
  if (p.intents && p.intents.length > 1) return 'multi-intent'
  if (p.ambiguous) return 'ambiguous'
  if (p.confidence !== undefined && p.confidence < 0.6) return 'low-confidence'
  return 'upstream-grey'
}

function formatPrior(prior: L3Prior | undefined): string {
  if (!prior) return '（无）'
  return JSON.stringify({
    decidedBy: prior.decidedBy,
    lane: prior.lane,
    domain: prior.domain,
    band: prior.band,
    confidence: prior.confidence,
    ambiguous: prior.ambiguous,
    reason: prior.reason,
    intents: prior.intents,
    clarification: prior.clarification,
  })
}

export interface BuildL3MessagesOptions {
  text: string
  history?: L3Input['history']
  attachments?: L3Input['attachments']
  facts?: L3Input['facts']
  prior?: L3Prior
  safety?: L3Input['safety']
  trigger?: string
}

/** 组装 L3 单次调用消息（system + user） */
export function buildL3Messages(options: BuildL3MessagesOptions): BaseMessage[] {
  const text = truncate(options.text.replace(/\s+/g, ' ').trim(), {
    length: 2000,
    omission: '…',
  })

  const user = [
    '## 升级触发',
    options.trigger ?? describeTrigger(options),
    '',
    '## 前置判定（来自上游，逐项复核；无则忽略）',
    formatPrior(options.prior),
    '',
    '## 历史摘要',
    summarizeHistory(options.history),
    '',
    '## 附件',
    formatAttachments(options.attachments),
    '',
    '## 结构特征（规则层已抽取，供参考）',
    formatFacts(options.facts),
    '',
    '## Few-shot（只示范判法，实际仍输出完整 JSON）',
    formatFewShots(),
    '',
    '## 用户消息',
    text || '（空）',
    '',
    '先给出判别理由，再输出唯一 JSON 对象。',
  ].join('\n')

  return [new SystemMessage(SYSTEM_PROMPT), new HumanMessage(user)]
}
