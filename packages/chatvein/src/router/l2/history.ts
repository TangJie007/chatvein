/**
 * L2 历史摘要：控 token、降延迟（设计 §12）。
 * 截断用 es-toolkit/compat.truncate，不手写。
 */
import { truncate } from 'es-toolkit/compat'
import type { L2HistoryTurn } from './types'

const DEFAULT_TURNS = 6
const DEFAULT_PER_TURN = 160

export interface SummarizeHistoryOptions {
  maxTurns?: number
  maxCharsPerTurn?: number
}

/** 取最近 N 轮，每轮截断，格式化为 prompt 段落 */
export function summarizeHistory(
  history: L2HistoryTurn[] | undefined,
  options: SummarizeHistoryOptions = {},
): string {
  if (!history?.length) return '（无）'
  const maxTurns = options.maxTurns ?? DEFAULT_TURNS
  const maxChars = options.maxCharsPerTurn ?? DEFAULT_PER_TURN
  const recent = history.slice(-maxTurns)
  return recent
    .map((t, i) => {
      const role = String(t.role || 'user')
      const body = truncate(String(t.content ?? '').replace(/\s+/g, ' ').trim(), {
        length: maxChars,
        omission: '…',
      })
      return `${i + 1}. [${role}] ${body || '（空）'}`
    })
    .join('\n')
}
