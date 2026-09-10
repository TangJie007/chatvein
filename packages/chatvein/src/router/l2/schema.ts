/**
 * L2 输出契约：zod schema → 枚举归一 → 失败即抛（调用方不重试、落兜底）。
 */
import { z } from 'zod'
import type { Band, Domain, Lane } from '../types'
import type { L2Judgement } from './types'

const LANE_SET = new Set<Lane>(['direct', 'agentic', 'orchestrated'])
const DOMAIN_SET = new Set<string>(['general', 'code'])
const BAND_SET = new Set<Band>(['trivial', 'simple', 'standard', 'complex'])

/** 模型常给的别名 → 规范枚举 */
const LANE_ALIASES: Record<string, Lane> = {
  direct: 'direct',
  chat: 'direct',
  simple: 'direct',
  qa: 'direct',
  agentic: 'agentic',
  agent: 'agentic',
  tool: 'agentic',
  tools: 'agentic',
  react: 'agentic',
  orchestrated: 'orchestrated',
  plan: 'orchestrated',
  complex: 'orchestrated',
  multi: 'orchestrated',
  workflow: 'orchestrated',
}

const DOMAIN_ALIASES: Record<string, Domain> = {
  general: 'general',
  chat: 'general',
  other: 'general',
  office: 'general',
  doc: 'general',
  docs: 'general',
  document: 'general',
  pdf: 'general',
  excel: 'general',
  code: 'code',
  coding: 'code',
  coder: 'code',
  dev: 'code',
  programming: 'code',
}

const BAND_ALIASES: Record<string, Band> = {
  trivial: 'trivial',
  tiny: 'trivial',
  none: 'trivial',
  simple: 'simple',
  easy: 'simple',
  small: 'simple',
  standard: 'standard',
  medium: 'standard',
  normal: 'standard',
  complex: 'complex',
  hard: 'complex',
  large: 'complex',
}

function normKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, '')
}

function normalizeLane(raw: unknown): Lane {
  const k = normKey(raw)
  const hit = LANE_ALIASES[k]
  if (hit && LANE_SET.has(hit)) return hit
  throw new Error(`invalid_lane:${String(raw)}`)
}

function normalizeDomain(raw: unknown): Domain {
  const k = normKey(raw)
  const hit = DOMAIN_ALIASES[k]
  if (hit && DOMAIN_SET.has(hit)) return hit
  // 允许扩展 domain（string & {}），但空串不行
  const s = String(raw ?? '').trim()
  if (!s) throw new Error('invalid_domain:empty')
  return s as Domain
}

function normalizeBand(raw: unknown): Band {
  const k = normKey(raw)
  const hit = BAND_ALIASES[k]
  if (hit && BAND_SET.has(hit)) return hit
  throw new Error(`invalid_band:${String(raw)}`)
}

function clampConfidence(n: number): number {
  if (!Number.isFinite(n)) return 0
  if (n > 1 && n <= 100) return Math.min(1, Math.max(0, n / 100))
  return Math.min(1, Math.max(0, n))
}

/**
 * 宽松入参 schema：枚举用 string，归一在 parse 阶段做。
 * 这样 withStructuredOutput 对弱模更友好。
 */
export const L2RawSchema = z.object({
  lane: z.string().min(1),
  domain: z.string().min(1),
  band: z.string().min(1),
  confidence: z.number(),
  ambiguous: z.boolean().optional().default(false),
  reason: z.string().max(200).optional().default(''),
  rewritten: z.string().min(1).max(500),
  searchQuery: z.string().max(400).optional(),
  intents: z.array(z.string()).max(8).optional(),
  clarification: z
    .object({
      question: z.string().min(1).max(200),
      options: z.array(z.string()).max(8).optional(),
    })
    .optional(),
})

export type L2Raw = z.infer<typeof L2RawSchema>

/**
 * schema 校验 → 枚举归一。
 * 任一步失败抛错，由 classify 捕获后 unavailable（不重试）。
 *
 * 归一函数与 L3 共用（L3 复用同一份词表，避免别名分叉）；`defaultReason`
 * 只在模型没给 reason 时兜底，L3 传 'l3' 保持分层溯源。
 */
export function parseL2Judgement(raw: unknown, defaultReason = 'l2'): L2Judgement {
  const parsed = L2RawSchema.parse(raw)
  const lane = normalizeLane(parsed.lane)
  const domain = normalizeDomain(parsed.domain)
  const band = normalizeBand(parsed.band)
  const confidence = clampConfidence(parsed.confidence)
  const ambiguous = parsed.ambiguous || confidence < 0.6
  return {
    lane,
    domain,
    band,
    confidence,
    ambiguous,
    reason: parsed.reason?.trim() || defaultReason,
    rewritten: parsed.rewritten.trim(),
    searchQuery: parsed.searchQuery?.trim() || undefined,
    intents: parsed.intents?.length ? parsed.intents : undefined,
    clarification: parsed.clarification,
  }
}
