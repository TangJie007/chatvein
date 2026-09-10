/**
 * L1 语义层：优先向量表检索，其次内存 embed 比对。
 * 模型与 LanceDB 由宿主负责；本包只判决。
 */
import { DEFAULT_BAND } from '../../constants'
import type {
  L1Decision,
  L1Options,
  PrototypeSearchHit,
} from '../types'
import { cosineSimilarity } from './cosine'
import { DEFAULT_PROTOTYPES, type Prototype } from './prototypes'

interface Scored {
  lane: Prototype['lane']
  domain: Prototype['domain']
  score: number
}

function pickDecision(
  ranked: Scored[],
  text: string,
  options: L1Options,
): L1Decision | null {
  const threshold = options.semanticThreshold ?? 0.78
  const margin = 0.05
  const accept = options.acceptThreshold ?? 0.85

  const top = ranked[0]
  const second = ranked[1]
  if (!top || top.score < threshold) return null
  if (second && top.score - second.score < margin) return null

  const confidence = Math.min(0.95, top.score)
  if (confidence < accept) return null

  return {
    kind: 'decide',
    decidedBy: 'semantic',
    lane: top.lane,
    domain: top.domain,
    band: DEFAULT_BAND[top.lane],
    confidence,
    ambiguous: false,
    needsHistory: false,
    query: { rewritten: text },
    reason: `semantic:${top.lane}/${top.domain}`,
  }
}

/** 同一 (lane,domain) 只保留最高分 */
function collapseByClass(hits: PrototypeSearchHit[]): Scored[] {
  const best = new Map<string, Scored>()
  for (const h of hits) {
    const key = `${h.lane}|${h.domain}`
    const prev = best.get(key)
    if (!prev || h.score > prev.score) {
      best.set(key, { lane: h.lane, domain: h.domain, score: h.score })
    }
  }
  return [...best.values()].sort((a, b) => b.score - a.score)
}

async function scoreViaSearch(
  text: string,
  options: L1Options,
): Promise<Scored[] | null> {
  if (!options.search) return null
  const hits = await options.search.search(text, 8)
  if (hits.length === 0) return []
  return collapseByClass(hits)
}

async function scoreViaEmbed(
  text: string,
  options: L1Options,
): Promise<Scored[] | null> {
  const embed = options.embed
  if (!embed) return null

  const prototypes = options.prototypes?.length
    ? options.prototypes
    : DEFAULT_PROTOTYPES

  const queryVec = await embed.embedQuery(text)
  const flat: Array<{ lane: Prototype['lane']; domain: Prototype['domain']; text: string }> =
    []
  for (const p of prototypes) {
    for (const t of p.texts) flat.push({ lane: p.lane, domain: p.domain, text: t })
  }

  let docVecs: number[][]
  if (embed.embedDocuments) {
    docVecs = await embed.embedDocuments(flat.map((f) => f.text))
  } else {
    docVecs = []
    for (const f of flat) docVecs.push(await embed.embedQuery(f.text))
  }

  const bestByClass = new Map<string, Scored>()
  for (let i = 0; i < flat.length; i++) {
    const item = flat[i]!
    const score = cosineSimilarity(queryVec, docVecs[i] ?? [])
    const key = `${item.lane}|${item.domain}`
    const prev = bestByClass.get(key)
    if (!prev || score > prev.score) {
      bestByClass.set(key, { lane: item.lane, domain: item.domain, score })
    }
  }
  return [...bestByClass.values()].sort((a, b) => b.score - a.score)
}

export async function decideBySemantic(
  text: string,
  options: L1Options,
): Promise<L1Decision | null> {
  const viaSearch = await scoreViaSearch(text, options)
  if (viaSearch) return pickDecision(viaSearch, text, options)

  const viaEmbed = await scoreViaEmbed(text, options)
  if (viaEmbed) return pickDecision(viaEmbed, text, options)

  return null
}
