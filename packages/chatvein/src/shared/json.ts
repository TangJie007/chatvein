/**
 * 从 LLM 文本输出里宽松提取一个 JSON 对象。
 *
 * 弱模常把 JSON 包在解释文字 / ```json 围栏里。策略：
 *   1) 整段 trim 后直接 JSON.parse；
 *   2) 失败则取第一个 `{` 到最后一个 `}` 的子串再 parse；
 *   3) 都失败抛错（由调用方走兜底，永不因此中断主链路）。
 *
 * 属 LangChain 领域形态去重（见 `.agents/notes/2026-09-08-third-party-utils-dedup.md`），
 * 不为此引 jsonrepair 等——L2 主路径是 withStructuredOutput，文本兜底只需最小抽取。
 */
export function extractJsonObject(text: string): unknown {
  const t = text.trim()
  try {
    return JSON.parse(t)
  } catch {
    const s = t.indexOf('{')
    const e = t.lastIndexOf('}')
    if (s >= 0 && e > s) return JSON.parse(t.slice(s, e + 1))
    throw new Error('no_json_object')
  }
}
