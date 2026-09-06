import type { ComplexityBand, ModelTier } from '@chatvein/common'
import { resolveDict, type HeuristicDict } from './dict'

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
  /** 产品仅支持中文；非中文为 unsupported */
  lang: 'zh' | 'unsupported'
  dictCoverage: 'full' | 'none'

  hasCodeFence: boolean
  hasUrl: boolean
  hasPathLike: boolean
  hasMention: boolean
  mentions: string[]
  hasSlashCmd: boolean
  slashCmd: string

  hitGreetingOnly: boolean
  hitSelfIntro: boolean
}

const PATH_RE =
  /(?:[A-Za-z]:\\|\/|\.\/|\.\.\/)[^\s*?"<>|]+|\b[\w.-]+\.(?:ts|tsx|js|jsx|py|go|rs|java|json|md|yml|yaml|toml|css|vue)\b|\b(?:package\.json|tsconfig\.json|pnpm-lock\.yaml)\b/i
const URL_RE = /https?:\/\/[^\s]+/i
const MENTION_RE = /@([\w\u4e00-\u9fff.-]+)/g
const SLASH_RE = /^\/([a-zA-Z][\w-]*)\b/
const CODE_FENCE_RE = /```/g
/** 自我介绍余下部分：像名字，不像任务句 */
const NAME_REST_RE = /^[\u4e00-\u9fffA-Za-z·]{1,8}$/
const NOT_NAME_RE = /[的了着过来去要帮写改做查看搜修跑]|代码|文件|登录|问题/

export function extractFacts(text: string, session: HeuristicSession): HeuristicCtx {
  const trimmed = text.trim()
  const textNorm = trimmed.toLowerCase()
  const charLen = [...trimmed].length
  const lang = detectLang(trimmed)
  const { dict, coverage } = resolveDict(lang)

  const mentions = [...trimmed.matchAll(MENTION_RE)].map((m) => m[1]!)
  const slash = trimmed.match(SLASH_RE)
  const codeFenceCount = countMatches(trimmed, CODE_FENCE_RE)

  return {
    ...session,
    text: trimmed,
    textNorm,
    charLen,
    tokenEst: estimateTokens(trimmed, lang),
    lang,
    dictCoverage: coverage,
    hasCodeFence: codeFenceCount >= 2,
    hasUrl: URL_RE.test(trimmed),
    hasPathLike: PATH_RE.test(trimmed),
    hasMention: mentions.length > 0,
    mentions,
    hasSlashCmd: Boolean(slash),
    slashCmd: slash?.[1] ?? '',
    hitGreetingOnly: isGreetingOnly(textNorm, dict),
    hitSelfIntro: isSelfIntro(textNorm, dict),
  }
}

function detectLang(text: string): 'zh' | 'unsupported' {
  let zh = 0
  let en = 0
  for (const ch of text) {
    if (/[\u4e00-\u9fff]/.test(ch)) zh++
    else if (/[A-Za-z]/.test(ch)) en++
  }
  if (zh === 0) return 'unsupported'
  if (en > 0 && en > zh * 2) return 'unsupported'
  return 'zh'
}

function estimateTokens(text: string, lang: HeuristicCtx['lang']): number {
  if (lang === 'zh') return Math.max(1, [...text].length)
  return Math.max(1, Math.ceil(text.length / 4))
}

function countMatches(text: string, re: RegExp): number {
  const flags = re.flags.includes('g') ? re.flags : `${re.flags}g`
  return [...text.matchAll(new RegExp(re.source, flags))].length
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

/**
 * 短句自我介绍：前缀 + 像名字的短余下（1～8 字，无任务痕迹）。
 */
export function isSelfIntro(textNorm: string, dict: HeuristicDict): boolean {
  const s = textNorm.replace(/[\s\p{P}\p{S}]+/gu, '')
  if (!s) return false
  const prefixes = [...(dict.selfIntroPrefixes ?? [])].sort((a, b) => b.length - a.length)
  for (const raw of prefixes) {
    const p = raw.replace(/\s+/g, '')
    if (!p || !s.startsWith(p)) continue
    const rest = s.slice(p.length)
    if (!NAME_REST_RE.test(rest)) continue
    if (NOT_NAME_RE.test(rest)) continue
    return true
  }
  return false
}
