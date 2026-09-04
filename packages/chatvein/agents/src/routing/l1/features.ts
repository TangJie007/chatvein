import type { ComplexityBand, ModelTier } from '@chatvein/common'
import { resolveDict, type HeuristicDict } from '../locales'

export interface HeuristicSession {
  turnIndex: number
  lastBand?: ComplexityBand
  lastAssistantHadTools: boolean
  recentFailure: boolean
  activeMode: 'chat' | 'group' | 'forge'
  forceTier?: ModelTier
}

export interface HeuristicCtx extends HeuristicSession {
  text: string
  textNorm: string
  charLen: number
  tokenEst: number
  lang: 'zh' | 'en' | 'mix' | 'unknown'
  dictCoverage: 'full' | 'partial' | 'none'

  hasCodeFence: boolean
  codeFenceCount: number
  hasUrl: boolean
  hasPathLike: boolean
  hasMention: boolean
  mentions: string[]
  hasSlashCmd: boolean
  slashCmd: string
  questionMarkCount: number
  listItemCount: number

  hitGreetingOnly: boolean
  hitTaskVerb: boolean
  hitToolVerb: boolean
  hitNegateTool: boolean
  hitMultiStep: boolean
  hitCompare: boolean
  hitGroupIntent: boolean
  hitMultiAgentNeed: boolean
  hitForgeIntent: boolean
  hitCorrection: boolean
}

const PATH_RE =
  /(?:[A-Za-z]:\\|\/|\.\/|\.\.\/)[^\s*?"<>|]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md|yml|yaml|toml|css|vue)\b|\b(?:package\.json|tsconfig\.json|pnpm-lock\.yaml)\b/i
const URL_RE = /https?:\/\/[^\s]+/i
const MENTION_RE = /@([\w\u4e00-\u9fff.-]+)/g
const SLASH_RE = /^\/([a-zA-Z][\w-]*)\b/
const LIST_RE = /(?:^|\n)\s*(?:\d+[.)]\s+|[-*•]\s+)/g
const CODE_FENCE_RE = /```/g

export function extractFacts(text: string, session: HeuristicSession): HeuristicCtx {
  const trimmed = text.trim()
  const textNorm = trimmed.toLowerCase()
  const charLen = [...trimmed].length
  const lang = detectLang(trimmed)
  const { dict, coverage } = resolveDict(lang)

  const codeFenceCount = countMatches(trimmed, CODE_FENCE_RE)
  const mentions = [...trimmed.matchAll(MENTION_RE)].map((m) => m[1]!)
  const slash = trimmed.match(SLASH_RE)

  const hitTaskVerb = includesAny(textNorm, dict.taskVerbs)
  const hitToolVerb = includesAny(textNorm, dict.toolVerbs)
  const hitNegateTool = includesAny(textNorm, dict.negateTools)

  return {
    ...session,
    text: trimmed,
    textNorm,
    charLen,
    tokenEst: estimateTokens(trimmed, lang),
    lang,
    dictCoverage: coverage,
    hasCodeFence: codeFenceCount >= 2,
    codeFenceCount,
    hasUrl: URL_RE.test(trimmed),
    hasPathLike: PATH_RE.test(trimmed),
    hasMention: mentions.length > 0,
    mentions,
    hasSlashCmd: Boolean(slash),
    slashCmd: slash?.[1] ?? '',
    questionMarkCount: countChars(trimmed, '？?¿؟'),
    listItemCount: countMatches(trimmed, LIST_RE),
    hitGreetingOnly: isGreetingOnly(textNorm, dict),
    hitTaskVerb,
    hitToolVerb,
    hitNegateTool,
    hitMultiStep: includesAny(textNorm, dict.multiStep),
    hitCompare: includesAny(textNorm, dict.compare),
    hitGroupIntent: includesAny(textNorm, dict.groupIntent),
    hitMultiAgentNeed: includesAny(textNorm, dict.multiAgentNeed),
    hitForgeIntent: includesAny(textNorm, dict.forgeIntent),
    hitCorrection: includesAny(textNorm, dict.correction),
  }
}

function detectLang(text: string): 'zh' | 'en' | 'mix' | 'unknown' {
  let zh = 0
  let en = 0
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) zh++
    else if (/[A-Za-z]/.test(ch)) en++
  }
  if (zh === 0 && en === 0) return 'unknown'
  if (zh > 0 && en > 0 && zh >= 2 && en >= 4) return 'mix'
  if (zh >= en) return 'zh'
  return 'en'
}

function estimateTokens(text: string, lang: HeuristicCtx['lang']): number {
  if (lang === 'zh' || lang === 'mix') return Math.max(1, [...text].length)
  return Math.max(1, Math.ceil(text.length / 4))
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  return [...text.matchAll(new RegExp(re.source, flags))].length
}

function countChars(text: string, chars: string): number {
  let n = 0
  for (const ch of text) if (chars.includes(ch)) n++
  return n
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => n && haystack.includes(n))
}

/** 整句几乎只有寒暄；禁止 includes('你好') 即真 */
export function isGreetingOnly(textNorm: string, dict: HeuristicDict): boolean {
  let s = textNorm.replace(/[\s\p{P}\p{S}]+/gu, '')
  if (!s) return false
  for (const p of dict.greetingParticles) {
    if (p && s.endsWith(p)) s = s.slice(0, -p.length)
  }
  if (!s) return false
  const greetings = [...dict.greetings].sort((a, b) => b.length - a.length)
  for (const g of greetings) {
    const gg = g.replace(/\s+/g, '')
    if (s === gg) return true
  }
  return false
}

/** 供 json-rules-engine 的 facts（全为可序列化标量） */
export function factsFromCtx(ctx: HeuristicCtx): Record<string, string | number | boolean> {
  return {
    charLen: ctx.charLen,
    tokenEst: ctx.tokenEst,
    lang: ctx.lang,
    dictCoverage: ctx.dictCoverage,
    hasCodeFence: ctx.hasCodeFence,
    codeFenceCount: ctx.codeFenceCount,
    hasUrl: ctx.hasUrl,
    hasPathLike: ctx.hasPathLike,
    hasMention: ctx.hasMention,
    hasSlashCmd: ctx.hasSlashCmd,
    slashCmd: ctx.slashCmd,
    questionMarkCount: ctx.questionMarkCount,
    listItemCount: ctx.listItemCount,
    hitGreetingOnly: ctx.hitGreetingOnly,
    hitTaskVerb: ctx.hitTaskVerb,
    hitToolVerb: ctx.hitToolVerb,
    hitNegateTool: ctx.hitNegateTool,
    hitMultiStep: ctx.hitMultiStep,
    hitCompare: ctx.hitCompare,
    hitGroupIntent: ctx.hitGroupIntent,
    hitMultiAgentNeed: ctx.hitMultiAgentNeed,
    hitForgeIntent: ctx.hitForgeIntent,
    hitCorrection: ctx.hitCorrection,
    turnIndex: ctx.turnIndex,
    lastBand: ctx.lastBand ?? '',
    lastAssistantHadTools: ctx.lastAssistantHadTools,
    recentFailure: ctx.recentFailure,
    activeMode: ctx.activeMode,
    forceTier: ctx.forceTier ?? '',
    hasForceTier: Boolean(ctx.forceTier),
    hasLastBand: Boolean(ctx.lastBand),
  }
}
