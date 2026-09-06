/**
 * 工具动态选用（层 C）：关键词预筛 C1 + 弱模型精筛 C2 + 预算裁剪 C3。
 *
 * 复用 `@chatvein/context` 的 `estimateMessagesTokens` / `truncateFolded`。
 * 见 docs/tool-selection-design.md 层 C。
 */
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { estimateMessagesTokens, truncateFolded } from '@chatvein/context'
import { humanizeToolName } from './tool-embed'
import type { ToolCatalogEntry } from './types'

/**
 * C1 关键词预筛：向量未就绪时的零成本兜底。
 * 命中候选按命中词数降序；全不命中 → 返回全部候选。
 */
export function keywordSelect(query: string, candidates: ToolCatalogEntry[]): string[] {
  const q = normalize(query)
  if (!q) return candidates.map((c) => c.id)
  const terms = tokenize(q)
  const scored: Array<{ id: string; score: number }> = []
  for (const c of candidates) {
    const hay = tokenize(
      `${c.id} ${humanizeToolName(c.id)} ${c.title} ${c.description} ${(c.keywords ?? []).join(' ')}`,
    )
    let score = 0
    for (const t of terms) if (hay.includes(t)) score += 1
    if (score > 0) scored.push({ id: c.id, score })
  }
  if (scored.length === 0) return candidates.map((c) => c.id)
  scored.sort((a, b) => b.score - a.score)
  return scored.map((s) => s.id)
}

export interface ToolCandidate {
  name: string
  description?: string
}

/**
 * C2 弱模型工具精筛：从候选精筛到 Top-K 相关工具 id。
 * 候选数 ≤ maxK → 直接全返（省一次弱模型调用）。
 * 失败 / 解析空 → 返回全部候选（回退 full）。
 */
export async function llmSelectTools(
  query: string,
  candidates: readonly ToolCandidate[],
  llmWeak: BaseChatModel,
  options: { maxK?: number; timeoutMs?: number } = {},
): Promise<string[]> {
  if (candidates.length === 0) return []
  const maxK = options.maxK ?? 10
  if (candidates.length <= maxK) return candidates.map((c) => c.name)

  const schema = z.object({ toolIds: z.array(z.string()) })
  const list = candidates
    .map((c, i) => `${i + 1}. ${c.name} — ${truncateFolded(c.description ?? '', 120)}`)
    .join('\n')
  const prompt =
    `从下列工具中选出与用户请求最相关的至多 ${maxK} 个，用于本轮对话。\n` +
    `只返回工具名列表，不要解释。\n\n用户请求：${query}\n\n工具列表：\n${list}`

  try {
    const extractor = llmWeak.withStructuredOutput(schema, { name: 'select_tools' })
    const res = await withTimeout(extractor.invoke(prompt), options.timeoutMs ?? 10_000)
    const picked = Array.isArray((res as { toolIds?: unknown })?.toolIds)
      ? ((res as { toolIds: string[] }).toolIds)
      : []
    const allowed = new Set(candidates.map((c) => c.name))
    const filtered = picked.filter((id: string) => allowed.has(id))
    return filtered.length > 0 ? filtered.slice(0, maxK) : candidates.map((c) => c.name)
  } catch {
    return candidates.map((c) => c.name)
  }
}

/**
 * C3 预算硬裁剪：按候选顺序（已按相关度排序）贪心加入，逼近 budgetTokens；
 * 超出则截断低相关项。始终至少保留第一个，避免空工具集。
 */
export function fitToolsWithinBudget(
  tools: readonly StructuredToolInterface[],
  budgetTokens: number,
): StructuredToolInterface[] {
  if (tools.length === 0) return []
  const out: StructuredToolInterface[] = []
  let used = 0
  for (const t of tools) {
    const cost = estimateMessagesTokens([{ content: `${t.name}: ${t.description ?? ''}` }])
    if (out.length > 0 && used + cost > budgetTokens) break
    out.push(t)
    used += cost
  }
  return out
}

async function withTimeout<T>(p: Promise<T>, ms?: number): Promise<T> {
  if (!ms) return p
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_, rej) => {
    timer = setTimeout(() => rej(new Error('llmSelectTools timeout')), ms)
  })
  try {
    return await Promise.race([p, timeout])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

function normalize(s: string): string {
  return s.toLowerCase().replace(/\s+/g, ' ').trim()
}

function tokenize(s: string): string[] {
  return normalize(s)
    .split(/[\s,._\-/:()（）]+/)
    .filter((w) => w.length >= 1)
}
