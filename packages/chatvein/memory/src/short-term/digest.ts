/**
 * 摘要正文的渲染与抽取式降级。
 *
 * 原则（design/03 §4）：记忆块用紧凑短格式，不带寒暄与推理过程；
 * 关掉模型也要能落摘要（写路径零额外 token 可降级）。
 */
import type { ShortTermMessage } from './types'

/** 摘要块标题：固定文案，保证无新增记忆时摘要块逐字节稳定（命中 prompt 缓存） */
export const SUMMARY_BLOCK_TITLE = '## 会话前文摘要（已压缩，非逐字原文）'

/** 把摘要正文渲染成可进上下文的块 */
export function renderSummaryBlock(summary: string): string {
  const body = (summary ?? '').trim()
  if (!body) return ''
  return `${SUMMARY_BLOCK_TITLE}\n${body}`
}

export interface DigestOptions {
  /** 每条消息抽取的字符上限 */
  perMessageChars?: number
  /** 摘要总字符上限 */
  maxChars?: number
}

/**
 * 抽取式摘要（无模型降级路径）：按句截断每条消息的首段，拼成紧凑条目。
 * 纯确定性函数——同样输入必然同样输出。
 */
export function extractiveDigest(
  messages: ReadonlyArray<ShortTermMessage>,
  options: DigestOptions = {},
): string {
  const perMessage = options.perMessageChars ?? 160
  const maxChars = options.maxChars ?? 1_500
  const lines: string[] = []
  for (const m of messages) {
    if (!m || (m.role !== 'user' && m.role !== 'assistant')) continue
    if (m.failed) continue
    const text = compactText(m.content, perMessage)
    if (!text) continue
    lines.push(`${m.role === 'user' ? '用户' : '助手'}：${text}`)
  }
  return clampChars(lines.join('\n'), maxChars)
}

/** 把新增消息并入已有摘要（抽取式路径）：拼接后按字符上限折叠 */
export function composeExtractive(
  previousSummary: string,
  messages: ReadonlyArray<ShortTermMessage>,
  maxChars: number,
): string {
  const addition = extractiveDigest(messages, {
    maxChars: Math.max(200, Math.floor(maxChars * 0.6)),
  })
  const prev = (previousSummary ?? '').trim()
  if (!prev) return clampChars(addition, maxChars)
  if (!addition) return clampChars(prev, maxChars)
  return clampChars(`${prev}\n${addition}`, maxChars)
}

/** 单条消息压成一行：去代码块、折叠空白、按句截断 */
export function compactText(content: string, maxChars: number): string {
  const text = (content ?? '')
    .replace(/\r/g, '')
    .replace(/```[\s\S]*?```/g, '[代码块]')
    .replace(/\s+/g, ' ')
    .trim()
  if (!text) return ''
  if (text.length <= maxChars) return text
  return cutAtSentence(text, maxChars)
}

function cutAtSentence(text: string, maxChars: number): string {
  const window = text.slice(0, maxChars)
  const lastBreak = Math.max(
    window.lastIndexOf('。'),
    window.lastIndexOf('！'),
    window.lastIndexOf('？'),
    window.lastIndexOf('.'),
    window.lastIndexOf('!'),
    window.lastIndexOf('?'),
    window.lastIndexOf('；'),
  )
  // 句子边界太靠前（不足 40%）时按字符硬切，避免丢掉过多信息
  if (lastBreak >= Math.floor(maxChars * 0.4)) return `${window.slice(0, lastBreak + 1)}`
  return `${window}…`
}

const FOLD_MARKER = '…（摘要已折叠）…'

/**
 * 按**字符**上限做头尾折叠。
 * 摘要的硬约束是长度（喂给弱模型的输出上限），故不复用按 token 计量的
 * `truncateFolded`（那套是给工具输出用的）。
 */
export function clampChars(text: string, maxChars: number): string {
  const src = (text ?? '').trim()
  if (!src) return ''
  if (maxChars <= 0) return ''
  if (src.length <= maxChars) return src

  const lines = src.split('\n')
  const budget = maxChars - FOLD_MARKER.length - 2
  if (budget <= 0) return src.slice(0, Math.max(0, maxChars))

  const headBudget = Math.floor(budget * 0.65)
  const tailBudget = budget - headBudget

  const head: string[] = []
  let headUsed = 0
  let headIdx = 0
  for (; headIdx < lines.length; headIdx++) {
    const line = lines[headIdx]!
    if (headUsed + line.length + 1 > headBudget) break
    headUsed += line.length + 1
    head.push(line)
  }

  const tail: string[] = []
  let tailUsed = 0
  let tailIdx = lines.length - 1
  for (; tailIdx >= 0; tailIdx--) {
    const line = lines[tailIdx]!
    if (tailUsed + line.length + 1 > tailBudget) break
    tailUsed += line.length + 1
    tail.unshift(line)
  }

  if (headIdx > tailIdx) {
    // 头尾区间重叠：单行就超限，退化为硬切头部
    const omitted = lines.length - head.length
    return omitted > 0
      ? `${head.join('\n')}\n${FOLD_MARKER}`
      : head.join('\n')
  }
  const omitted = tailIdx - headIdx + 1
  return omitted > 0 ? [...head, FOLD_MARKER, ...tail].join('\n') : head.join('\n')
}
