/**
 * 输入归一化：剥零宽 → NFKC → 折叠空白。
 * L0 安全扫描与 L1 facts / 缓存 key 必须共用。
 */
export function normalizeText(raw: string): string {
  return raw
    .replace(/[\u200B-\u200D\uFEFF\u00AD]/g, '')
    .normalize('NFKC')
    .replace(/\s+/g, ' ')
    .trim()
}
