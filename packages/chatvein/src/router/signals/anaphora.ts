/**
 * 指代 / 续做信号（L0 缓存 key 与 L1 facts 共用）。
 */

export const ANAPHORA_RE =
  /(它|他|她|这个|那个|这些|那些|上面|前面|继续|再改|再试|同上|如上|还是|第二个|上一个)|(\b(it|this|that|those|these|same|again|continue|above|previous)\b)/i

export function hasAnaphora(text: string): boolean {
  return ANAPHORA_RE.test(text)
}
