import MiniSearch from 'minisearch'
import type { ComplexityBand, RoutePrototype, ToolPolicy } from '@chatvein/common'

export interface Bm25SearchHit {
  id: string
  score: number
  band: Exclude<ComplexityBand, 'unknown'>
  tools: ToolPolicy
}

export interface Bm25IndexOptions {
  scoreMin?: number
  limit?: number
  voteRatio?: number
}

interface ProtoDoc {
  id: string
  text: string
  lang?: string
}

/** 轻量分词：空白切分 + CJK 二字 bigram（索引与查询共用） */
export function tokenizeForBm25(text: string): string[] {
  const lower = text.toLowerCase().trim()
  if (!lower) return []
  const tokens: string[] = []
  const parts = lower.split(/[^\p{L}\p{N}\u4e00-\u9fff]+/u).filter(Boolean)
  for (const p of parts) {
    if (/[\u4e00-\u9fff]/.test(p)) {
      if (p.length === 1) tokens.push(p)
      else {
        for (let i = 0; i < p.length - 1; i++) tokens.push(p.slice(i, i + 2))
      }
    } else {
      tokens.push(p)
    }
  }
  return tokens
}

function createMiniSearch(): MiniSearch<ProtoDoc> {
  return new MiniSearch<ProtoDoc>({
    fields: ['text'],
    idField: 'id',
    storeFields: ['lang'],
    tokenize: (text) => tokenizeForBm25(text),
    // tokenize 已小写；禁止默认再丢弃短 term（CJK bigram 需保留）
    processTerm: (term) => term,
    searchOptions: {
      tokenize: (text) => tokenizeForBm25(text),
      processTerm: (term) => term,
      combineWith: 'OR',
      // 短中文先例：关闭模糊，避免 bigram 被错误扩写
      fuzzy: false,
      prefix: false,
    },
  })
}

/**
 * L1.5 先例索引（MiniSearch BM25 类打分）。
 * 对外类名保留 RouteBm25Index，避免调用方大改。
 */
export class RouteBm25Index {
  private engine: MiniSearch<ProtoDoc> | null = null
  private byId = new Map<string, RoutePrototype>()
  private readonly scoreMin: number
  private readonly limit: number
  readonly voteRatio: number

  constructor(options: Bm25IndexOptions = {}) {
    // MiniSearch 分数量纲与 wink 不同；默认略抬高门槛压噪声
    this.scoreMin = options.scoreMin ?? 0.5
    this.limit = options.limit ?? 5
    this.voteRatio = options.voteRatio ?? 0.6
  }

  get size(): number {
    return this.byId.size
  }

  reload(prototypes: RoutePrototype[]): void {
    this.byId.clear()
    this.engine = createMiniSearch()
    const docs: ProtoDoc[] = []
    for (const p of prototypes) {
      if (p.band === undefined) continue
      this.byId.set(p.id, p)
      docs.push({ id: p.id, text: p.text, lang: p.lang })
    }
    if (docs.length > 0) this.engine.addAll(docs)
  }

  search(query: string, lang?: RoutePrototype['lang']): Bm25SearchHit[] {
    if (!this.engine || this.byId.size === 0) return []
    const raw = this.engine.search(query, {
      fuzzy: false,
      prefix: false,
      combineWith: 'OR',
      filter: (result) => {
        if (!lang || lang === 'mix') return true
        const docLang = (result as { lang?: string }).lang
        return !docLang || docLang === lang
      },
    })

    const hits: Bm25SearchHit[] = []
    for (const row of raw) {
      const proto = this.byId.get(String(row.id))
      if (!proto) continue
      hits.push({ id: proto.id, score: row.score, band: proto.band, tools: proto.tools })
      if (hits.length >= this.limit) break
    }
    if (hits.length === 0 || hits[0]!.score < this.scoreMin) return []
    return hits
  }

  vote(hits: Bm25SearchHit[]): {
    band: Exclude<ComplexityBand, 'unknown'>
    tools: ToolPolicy
    ratio: number
    adopted: boolean
  } | null {
    if (hits.length === 0) return null
    const bandWeight = new Map<string, number>()
    const toolWeight = new Map<ToolPolicy, number>()
    let total = 0
    for (const h of hits) {
      total += h.score
      bandWeight.set(h.band, (bandWeight.get(h.band) ?? 0) + h.score)
      toolWeight.set(h.tools, (toolWeight.get(h.tools) ?? 0) + h.score)
    }
    if (total <= 0) return null
    let bestBand: Exclude<ComplexityBand, 'unknown'> = hits[0]!.band
    let bestBandW = 0
    for (const [b, w] of bandWeight) {
      if (w > bestBandW) {
        bestBandW = w
        bestBand = b as Exclude<ComplexityBand, 'unknown'>
      }
    }
    const toolOrder: ToolPolicy[] = ['none', 'unknown', 'full']
    let bestTools: ToolPolicy = 'none'
    let bestToolW = -1
    for (const t of toolOrder) {
      const w = toolWeight.get(t) ?? 0
      if (w >= bestToolW) {
        bestToolW = w
        bestTools = t
      }
    }
    const ratio = bestBandW / total
    return {
      band: bestBand,
      tools: bestTools,
      ratio,
      adopted: ratio >= this.voteRatio,
    }
  }
}
