/**
 * 语言资源加载（一期仅 zh + _common）。
 * 扩语种：加 locales/{lang}.json 与 prototypes/{lang}.json，并在 SUPPORTED_LANGS 登记。
 */
import type { RoutePrototype } from '@chatvein/common'
import commonDict from './_common.json'
import zhDict from './zh.json'
import zhPrototypes from './prototypes/zh.json'

export type SupportedLocale = 'zh'
export type DictLang = SupportedLocale | '_common'

export interface HeuristicDict {
  greetings: string[]
  greetingParticles: string[]
  /** 自我介绍前缀（句首匹配，非整句全等） */
  selfIntroPrefixes: string[]
  taskVerbs: string[]
  toolVerbs: string[]
  negateTools: string[]
  multiStep: string[]
  compare: string[]
  groupIntent: string[]
  multiAgentNeed: string[]
  forgeIntent: string[]
  correction: string[]
}

/** 一期启用的语言；未登记 → dictCoverage=none */
export const SUPPORTED_LANGS: readonly SupportedLocale[] = ['zh']

const DICT_BY_LANG: Record<DictLang, HeuristicDict> = {
  _common: commonDict as HeuristicDict,
  zh: zhDict as HeuristicDict,
}

const PROTOTYPES_BY_LANG: Record<SupportedLocale, RoutePrototype[]> = {
  zh: zhPrototypes as RoutePrototype[],
}

export function mergeDicts(...dicts: HeuristicDict[]): HeuristicDict {
  const keys: (keyof HeuristicDict)[] = [
    'greetings',
    'greetingParticles',
    'selfIntroPrefixes',
    'taskVerbs',
    'toolVerbs',
    'negateTools',
    'multiStep',
    'compare',
    'groupIntent',
    'multiAgentNeed',
    'forgeIntent',
    'correction',
  ]
  const out = {} as HeuristicDict
  for (const k of keys) {
    const set = new Set<string>()
    for (const d of dicts) {
      for (const w of d[k] ?? []) set.add(String(w).toLowerCase())
    }
    out[k] = [...set]
  }
  return out
}

export function resolveDict(lang: 'zh' | 'en' | 'mix' | 'unknown'): {
  dict: HeuristicDict
  coverage: 'full' | 'partial' | 'none'
} {
  const common = DICT_BY_LANG._common
  if (lang === 'zh') {
    return { dict: mergeDicts(common, DICT_BY_LANG.zh), coverage: 'full' }
  }
  // 中英混排：一期仍用 zh 词典（产品主语言），标记 partial
  if (lang === 'mix') {
    return { dict: mergeDicts(common, DICT_BY_LANG.zh), coverage: 'partial' }
  }
  // en / unknown：无专属词典包
  return { dict: mergeDicts(common), coverage: 'none' }
}

/** 默认先例：仅已支持语言的并集 */
export function loadDefaultPrototypes(
  langs: readonly SupportedLocale[] = SUPPORTED_LANGS,
): RoutePrototype[] {
  const out: RoutePrototype[] = []
  for (const lang of langs) {
    out.push(...(PROTOTYPES_BY_LANG[lang] ?? []))
  }
  return out
}

/** @deprecated 用 resolveDict；保留别名兼容旧导出 */
export const DEFAULT_DICTS = DICT_BY_LANG

/** @deprecated 用 loadDefaultPrototypes */
export const DEFAULT_PROTOTYPES = loadDefaultPrototypes()
