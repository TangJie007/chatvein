/**
 * 头尾保留 + 中间折叠的截断器（PRD 5.3.5 / M5 第一项）。
 *
 * 工具输出、超长历史消息在进入上下文前一律过这里：
 * 保留头部（通常是上下文/请求）与尾部（通常是错误/结论），中间折叠为一行标注。
 */
import { estimateTextTokens } from './tokens'

export interface TruncateResult {
  text: string
  truncated: boolean
  /** 被折叠掉的行数 */
  omittedLines: number
}

export interface TruncateOptions {
  /** 头部占比（默认 0.6） */
  headRatio?: number
  /** 省略标注（默认中文） */
  marker?: (omitted: number) => string
}

const DEFAULT_MARKER = (omitted: number) => `…（已省略 ${omitted} 行）…`

/**
 * 按 token 预算折叠截断。
 *
 * - 未超预算：原文返回，`truncated=false`
 * - 超预算：头 60% + 省略标注 + 尾 40%
 * - 头尾区间重叠（单行就超预算）：退化为按字符硬切头部
 */
export function truncateFolded(
  text: string,
  maxTokens: number,
  options: TruncateOptions = {},
): TruncateResult {
  const noop: TruncateResult = { text, truncated: false, omittedLines: 0 }
  if (!text) return noop
  if (maxTokens <= 0) {
    return { text: '', truncated: text.length > 0, omittedLines: text.split('\n').length }
  }
  if (estimateTextTokens(text) <= maxTokens) return noop

  const marker = options.marker ?? DEFAULT_MARKER
  const headRatio = clamp01(options.headRatio ?? 0.6)
  const lines = text.split('\n')
  const budget = Math.max(1, maxTokens - estimateTextTokens(marker(0)))

  const headBudget = Math.max(1, Math.floor(budget * headRatio))
  const tailBudget = Math.max(0, budget - headBudget)

  const head: string[] = []
  let headUsed = 0
  let headIdx = 0
  for (; headIdx < lines.length; headIdx++) {
    const cost = estimateTextTokens(lines[headIdx]!)
    if (headUsed + cost > headBudget) break
    headUsed += cost
    head.push(lines[headIdx]!)
  }

  const tail: string[] = []
  let tailUsed = 0
  let tailIdx = lines.length - 1
  for (; tailIdx >= 0; tailIdx--) {
    const cost = estimateTextTokens(lines[tailIdx]!)
    if (tailUsed + cost > tailBudget) break
    tailUsed += cost
    tail.unshift(lines[tailIdx]!)
  }

  // 头尾区间重叠：说明单行就超出预算，退化为硬切头部
  if (headIdx > tailIdx) {
    const hard: string[] = []
    let used = 0
    for (const line of lines) {
      const cost = estimateTextTokens(line)
      if (used + cost > budget) break
      used += cost
      hard.push(line)
    }
    const omitted = lines.length - hard.length
    const body = hard.length ? hard.join('\n') : ''
    return {
      text: omitted > 0 ? `${body}\n${marker(omitted)}` : body,
      truncated: true,
      omittedLines: omitted,
    }
  }

  const omitted = tailIdx - headIdx + 1
  if (omitted <= 0) {
    return { text: head.join('\n'), truncated: true, omittedLines: lines.length - head.length }
  }
  return {
    text: [...head, marker(omitted), ...tail].join('\n'),
    truncated: true,
    omittedLines: omitted,
  }
}

function clamp01(n: number): number {
  if (Number.isNaN(n)) return 0.6
  return Math.min(1, Math.max(0, n))
}
