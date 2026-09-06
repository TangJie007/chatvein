/**
 * CJK-aware tokenizer for MiniSearch / BM25-style tool alias search.
 * Whitespace/punct split + 二字 bigram for CJK runs（与曾用 L1 先例索引同套路）.
 */

const CJK_CHAR = /[\u3400-\u9fff\uf900-\ufaff]/u
const SPLIT_RE = /[\s,._\-/:;|｜()（）\[\]【】「」『』<>《》"'`~!@#$%^&*+=?。，、；：！？]+/u

/** 归一化后切词：拉丁词保留整词，CJK 连续段拆成 bigram（单字保留） */
export function tokenizeForBm25(text: string): string[] {
  const normalized = text.toLowerCase().replace(/\s+/g, ' ').trim()
  if (!normalized) return []
  const out: string[] = []
  for (const part of normalized.split(SPLIT_RE)) {
    if (!part) continue
    let buf = ''
    let mode: 'none' | 'latin' | 'cjk' = 'none'
    const flush = () => {
      if (!buf) return
      if (mode === 'cjk') pushCjkBigrams(out, buf)
      else out.push(buf)
      buf = ''
      mode = 'none'
    }
    for (const ch of part) {
      const isCjk = CJK_CHAR.test(ch)
      // 无 g 标志时 test() 不保留 lastIndex；仍显式复位以免未来改动踩坑
      CJK_CHAR.lastIndex = 0
      const next: 'latin' | 'cjk' = isCjk ? 'cjk' : 'latin'
      if (mode !== 'none' && mode !== next) flush()
      mode = next
      buf += ch
    }
    flush()
  }
  return out
}

function pushCjkBigrams(out: string[], s: string): void {
  if (s.length <= 1) {
    if (s) out.push(s)
    return
  }
  for (let i = 0; i < s.length - 1; i++) {
    out.push(s.slice(i, i + 2))
  }
}
