/**
 * L1 快速层：规则信号 + 可选语义（向量表检索 / 内存 embed）。
 *
 * 离线时唯一可用分类层。设计：docs/分层路由与预算决策.md §4.2
 *
 * 目录职责：
 * - facts/*     确定性信号抽取
 * - decide.ts   规则判决
 * - semantic/*  语料种子 + 语义判决（检索端口由宿主注入）
 */
import { decideL1 } from './decide'
import { extractFacts } from './facts'
import { decideBySemantic } from './semantic'
import type { Facts, L1Input, L1Options, L1Result } from './types'

export type {
  EmbedPort,
  Facts,
  L1Attachment,
  L1Decision,
  L1Input,
  L1Options,
  L1Pass,
  L1Result,
  L1Thresholds,
  PrototypeSearchHit,
  PrototypeSearchPort,
} from './types'

export { extractFacts } from './facts'
export { decideL1 } from './decide'
export { decideBySemantic } from './semantic'
export { DEFAULT_PROTOTYPES, prototypeStats, prototypeTotal } from './semantic/prototypes'
export type { Prototype } from './semantic/prototypes'
export {
  ROUTE_PROTOTYPE_TABLE,
  listRoutePrototypeDocs,
  getRoutePrototypeCorpusVersion,
  getRoutePrototypeSeed,
  type RoutePrototypeDoc,
  type RoutePrototypeDocMeta,
  type RoutePrototypeSeed,
} from './semantic/corpus'
export { cosineSimilarity } from './semantic/cosine'
export {
  OFFICE_KEYWORDS,
  CODE_KEYWORDS,
  MULTI_STEP_KEYWORDS,
} from './facts/keywords'
export { isGreetingOnly, isSelfIntro } from './facts/social'

/**
 * L1 编排：先规则；未定案时优先 search（向量表），否则 embed；都无则 pass。
 */
export async function runL1(
  input: L1Input | string,
  options: L1Options = {},
): Promise<L1Result> {
  const normalized: L1Input = typeof input === 'string' ? { text: input } : input
  const facts: Facts = extractFacts(normalized)
  const accept = options.acceptThreshold ?? 0.85
  const rule = decideL1(facts, accept)
  if (rule.kind === 'decide') return rule

  if (options.search || options.embed) {
    const sem = await decideBySemantic(facts.textNorm || normalized.text, options)
    if (sem) return sem
  }

  return rule
}
