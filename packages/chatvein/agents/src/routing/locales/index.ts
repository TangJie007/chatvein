/**
 * 路由词典：仅中文寒暄 / 自我介绍（L1 短路用）。
 */
import zhDict from './zh.json'

export type SupportedLocale = 'zh'

export interface HeuristicDict {
  greetings: string[]
  greetingParticles: string[]
  /** 自我介绍前缀（句首匹配） */
  selfIntroPrefixes: string[]
}

export const SUPPORTED_LANGS: readonly SupportedLocale[] = ['zh']

export const ZH_DICT: HeuristicDict = normalizeDict(zhDict as HeuristicDict)

function normalizeDict(raw: HeuristicDict): HeuristicDict {
  return {
    greetings: uniqLower(raw.greetings),
    greetingParticles: uniqLower(raw.greetingParticles),
    selfIntroPrefixes: uniqLower(raw.selfIntroPrefixes),
  }
}

function uniqLower(xs: string[] | undefined): string[] {
  return [...new Set((xs ?? []).map((w) => String(w).toLowerCase()))]
}

/** 仅 `zh` 为 full；非中文 coverage=none */
export function resolveDict(lang: 'zh' | 'unsupported'): {
  dict: HeuristicDict
  coverage: 'full' | 'none'
} {
  if (lang === 'zh') return { dict: ZH_DICT, coverage: 'full' }
  return { dict: ZH_DICT, coverage: 'none' }
}

/** @deprecated 用 ZH_DICT */
export const DEFAULT_DICTS = { zh: ZH_DICT }
