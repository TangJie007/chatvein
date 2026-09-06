/**
 * 工具动态选用（层 C）：关键词预筛 C1 + 弱模型精筛 C2 + 预算裁剪 C3。
 *
 * C2：优先 `withStructuredOutput`；遇 response_format 不支持等 → 纯文本 JSON 兜底
 * （ChatPromptTemplate，与路由 L2 同套路）。
 * 见 docs/tool-selection-design.md 层 C。
 */
import { z } from 'zod'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { BaseMessage } from '@langchain/core/messages'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { estimateMessagesTokens } from '@chatvein/context'
import { humanizeToolName } from './tool-embed'
import { formatToolSelectPromptMessages } from './select-prompt'
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

/** C2 精筛结果状态（供埋点） */
export type LlmSelectToolsStatus =
  | 'selected_structured'
  | 'selected_text'
  | 'passthrough_small'
  | 'fallback_empty'
  | 'fallback_error'

export interface LlmSelectToolsResult {
  toolIds: string[]
  status: LlmSelectToolsStatus
}

const ToolSelectJudgementSchema = z.object({
  toolIds: z.array(z.string()),
})

type ToolSelectJudgement = z.infer<typeof ToolSelectJudgementSchema>

/**
 * C2 弱模型工具精筛：
 * 1) `withStructuredOutput`（主路径）
 * 2) 不支持 response_format / 结构化失败 → 普通 invoke + 抽 JSON（兜底）
 * 候选数 ≤ maxK → 直接全返；仍失败 / 空列表 → 回退全部候选。
 */
export async function llmSelectTools(
  query: string,
  candidates: readonly ToolCandidate[],
  llmWeak: BaseChatModel,
  options: { maxK?: number; timeoutMs?: number } = {},
): Promise<LlmSelectToolsResult> {
  if (candidates.length === 0) return { toolIds: [], status: 'selected_structured' }
  const maxK = options.maxK ?? 10
  if (candidates.length <= maxK) {
    return { toolIds: candidates.map((c) => c.name), status: 'passthrough_small' }
  }

  const timeoutMs = options.timeoutMs ?? 10_000
  const allIds = candidates.map((c) => c.name)
  const allowed = new Set(allIds)
  const messages = await formatToolSelectPromptMessages(query, candidates, maxK)

  // —— 主路径：结构化输出 ——
  const structured = await tryStructuredSelect(llmWeak, messages, allowed, maxK, timeoutMs)
  if (structured.kind === 'ok') {
    return { toolIds: structured.toolIds, status: 'selected_structured' }
  }
  if (structured.kind === 'empty') {
    return { toolIds: allIds, status: 'fallback_empty' }
  }
  if (structured.kind === 'fatal') {
    return { toolIds: allIds, status: 'fallback_error' }
  }
  // structured.kind === 'unsupported' → 文本兜底

  // —— 兜底：纯文本 JSON ——
  try {
    const res = await withTimeout(llmWeak.invoke(messages), timeoutMs)
    const raw = messageContentToString(res.content)
    const judgement = ToolSelectJudgementSchema.parse(extractJsonObject(raw))
    const filtered = filterToolIds(judgement.toolIds, allowed, maxK)
    if (filtered.length > 0) {
      return { toolIds: filtered, status: 'selected_text' }
    }
    return { toolIds: allIds, status: 'fallback_empty' }
  } catch {
    return { toolIds: allIds, status: 'fallback_error' }
  }
}

type StructuredAttempt =
  | { kind: 'ok'; toolIds: string[] }
  | { kind: 'empty' }
  | { kind: 'unsupported' }
  | { kind: 'fatal' }

async function tryStructuredSelect(
  llmWeak: BaseChatModel,
  messages: BaseMessage[],
  allowed: Set<string>,
  maxK: number,
  timeoutMs: number,
): Promise<StructuredAttempt> {
  if (typeof llmWeak.withStructuredOutput !== 'function') {
    return { kind: 'unsupported' }
  }
  try {
    const extractor = llmWeak.withStructuredOutput(ToolSelectJudgementSchema, {
      name: 'select_tools',
    })
    const res = (await withTimeout(
      extractor.invoke(messages),
      timeoutMs,
    )) as ToolSelectJudgement
    const picked = Array.isArray(res?.toolIds) ? res.toolIds : []
    const filtered = filterToolIds(picked, allowed, maxK)
    if (filtered.length > 0) return { kind: 'ok', toolIds: filtered }
    return { kind: 'empty' }
  } catch (err) {
    if (isResponseFormatUnsupported(err)) return { kind: 'unsupported' }
    // 超时 / 鉴权等：不再浪费一次文本调用
    if (isFatalLlmError(err)) return { kind: 'fatal' }
    // 其它结构化解析失败：仍尝试文本兜底
    return { kind: 'unsupported' }
  }
}

function filterToolIds(picked: string[], allowed: Set<string>, maxK: number): string[] {
  return picked.filter((id) => allowed.has(id)).slice(0, maxK)
}

/** 端不支持 response_format / json_schema 等 */
export function isResponseFormatUnsupported(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /response_format|json_schema|structured.?output|unavailable now|not support.*json/i.test(
    msg,
  )
}

function isFatalLlmError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /timeout|abort|401|unauthorized|invalid.*key|ENOTFOUND|ECONNREFUSED/i.test(msg)
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

function extractJsonObject(text: string): unknown {
  const trimmed = text.trim()
  try {
    return JSON.parse(trimmed) as unknown
  } catch {
    const start = trimmed.indexOf('{')
    const end = trimmed.lastIndexOf('}')
    if (start >= 0 && end > start) {
      return JSON.parse(trimmed.slice(start, end + 1)) as unknown
    }
    throw new Error('tool_select_no_json_object')
  }
}

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return content == null ? '' : String(content)
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
