/**
 * Markdown 本地预处理：切分章节、建索引（零模型调用）。
 * M1 用它做确定性任务树；M2 再叠加模型抽取（按章节抽功能点/验收标准）。
 */

export interface MdSection {
  /** 章节标题（去掉 # 号） */
  title: string
  /** 标题层级（1-6） */
  level: number
  /** 章节正文（不含标题行） */
  body: string
  /** 回溯锚点：标题原文，用于 requirementRef */
  anchor: string
  /** 章节序号（按出现顺序，从 1 开始） */
  index: number
}

/** 按 ATX 标题（# .. ######）切分；文档开头无标题的内容归入 "概述" */
export function splitMarkdownSections(markdown: string): MdSection[] {
  const lines = markdown.split(/\r?\n/)
  const sections: MdSection[] = []
  let current: { title: string; level: number; anchor: string; body: string[] } | null = null
  let preamble: string[] = []

  const push = (): void => {
    if (!current) return
    sections.push({
      title: current.title,
      level: current.level,
      anchor: current.anchor,
      body: current.body.join('\n').trim(),
      index: sections.length + 1,
    })
  }

  for (const line of lines) {
    const m = /^(#{1,6})\s+(.*?)\s*$/.exec(line)
    if (m) {
      push()
      const level = m[1]!.length
      const title = m[2]!.trim()
      current = { title, level, anchor: line.trim(), body: [] }
    } else if (current) {
      current.body.push(line)
    } else {
      preamble.push(line)
    }
  }
  push()

  // 无任何标题：整篇作为一个章节
  if (sections.length === 0) {
    sections.push({
      title: '概述',
      level: 1,
      anchor: '概述',
      body: markdown.trim(),
      index: 1,
    })
  } else if (preamble.join('\n').trim()) {
    // 有标题但开头有前言：插到最前
    sections.unshift({
      title: '概述',
      level: 1,
      anchor: '概述',
      body: preamble.join('\n').trim(),
      index: 1,
    })
    sections.forEach((s, i) => (s.index = i + 1))
  }

  return sections
}

/** 从章节正文抽取 "- [ ]" / 数字编号 / 祈使句作为验收标准候选 */
export function extractAcceptance(body: string): string[] {
  const out: string[] = []
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.trim()
    if (!line) continue
    const checkbox = /^[-*]\s*\[[ xX]\]\s*(.+)$/.exec(line)
    const numbered = /^\d+[.、)]\s*(.+)$/.exec(line)
    const bullet = /^[-*]\s+(.+)$/.exec(line)
    const cand = checkbox?.[1] ?? numbered?.[1] ?? bullet?.[1]
    if (cand && cand.length <= 200) out.push(cand.trim())
  }
  return out
}
