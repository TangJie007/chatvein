/**
 * L1 寒暄 / 自我介绍词典（仅中文）。
 */
import zhDict from './zh.json'

export interface HeuristicDict {
  greetings: string[]
  greetingParticles: string[]
  selfIntroPrefixes: string[]
}

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

export function resolveDict(lang: 'zh' | 'unsupported'): {
  dict: HeuristicDict
  coverage: 'full' | 'none'
} {
  if (lang === 'zh') return { dict: ZH_DICT, coverage: 'full' }
  return { dict: ZH_DICT, coverage: 'none' }
}
