/**
 * 启发式 token 估算。
 *
 * 不引入外部 tokenizer（体积 / 离线 / 多网关口径不一的约束）：这里只需要
 * 「量级正确」的估计，用于预算护栏与上下文裁剪，不用于计费。
 *
 * 口径：CJK 字符 ≈ 0.7 token；其余（拉丁字母、数字、符号）≈ 0.25 token；
 * 每条消息额外 +4 token 作为角色/分隔符开销。
 */

/** 单条消息的结构性开销（role / 分隔符） */
export const TOKENS_PER_MESSAGE = 4

const CJK_RANGES: ReadonlyArray<readonly [number, number]> = [
  // CJK 部首扩展 / 中日韩统一表意文字
  [0x2e80, 0x9fff],
  // CJK 兼容表意文字
  [0xf900, 0xfaff],
  // 全角/半角形式、全角标点
  [0xff00, 0xffef],
  // CJK 符号与标点（含「。」「，」）
  [0x3000, 0x303f],
]

function isCjkCodePoint(cp: number): boolean {
  for (const [lo, hi] of CJK_RANGES) {
    if (cp >= lo && cp <= hi) return true
  }
  return false
}

/** 估算纯文本 token 数（不含消息结构开销） */
export function estimateTextTokens(text: string): number {
  if (!text) return 0
  let cjk = 0
  let other = 0
  for (const ch of text) {
    const cp = ch.codePointAt(0) ?? 0
    if (isCjkCodePoint(cp)) cjk += 1
    else other += 1
  }
  return Math.ceil(cjk * 0.7 + other * 0.25)
}

/** 估算一组消息（role + content）的 token 数 */
export function estimateMessagesTokens(messages: ReadonlyArray<{ content: string }>): number {
  let total = 0
  for (const m of messages) {
    total += estimateTextTokens(m?.content ?? '') + TOKENS_PER_MESSAGE
  }
  return total
}

/**
 * 把 token 上限换算成「保守字符数」，用于按字符做裁剪。
 * 取 CJK 口径（1 token ≈ 1.4 字）与 ASCII 口径（1 token ≈ 4 字）的下界，
 * 保证换算后的字符数不会超出 token 预算。
 */
export function tokensToChars(maxTokens: number): number {
  return Math.max(0, Math.floor(maxTokens * 1.4))
}
