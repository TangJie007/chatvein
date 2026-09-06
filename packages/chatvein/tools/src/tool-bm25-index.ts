/**
 * 工具名 / 别名内存 BM25 索引（MiniSearch）。
 * 专供 C1 混合预筛的 lexical 路；与向量库分轨、进程内重建。
 */
import MiniSearch from 'minisearch'
import { catalogEntryForTool, humanizeToolName } from './tool-embed'
import { tokenizeForBm25 } from './tokenize-cjk'

/** BM25 建档输入（与 ToolVectorIndexInput 对齐的最小子集） */
export interface ToolBm25IndexInput {
  name: string
  description?: string
}

export interface ToolBm25Doc {
  id: string
  name: string
  human: string
  aliases: string
  title: string
}

export interface ToolBm25Hit {
  id: string
  score: number
}

export interface ToolBm25IndexOptions {
  /** MiniSearch 字段加权：工具名/别名强信号 */
  boost?: Partial<Record<'name' | 'human' | 'aliases' | 'title', number>>
}

const DEFAULT_BOOST = {
  name: 4,
  human: 3,
  aliases: 3,
  title: 1.5,
} as const

/** 从工具输入拼装 BM25 文档（目录 keywords = 别名） */
export function toolBm25Doc(input: ToolBm25IndexInput): ToolBm25Doc | null {
  const id = input.name?.trim()
  if (!id) return null
  const entry = catalogEntryForTool(id)
  const aliases = [
    ...(entry?.keywords ?? []),
    ...(typeof input.description === 'string' && !entry ? [input.description] : []),
  ]
    .filter(Boolean)
    .join(' ')
  return {
    id,
    name: id,
    human: humanizeToolName(id),
    aliases,
    title: entry?.title ?? '',
  }
}

/**
 * 工具别名 BM25：规模≈目录工具数，毫秒级；随 ToolVectorIndex build/replace/sync 重建。
 */
export class ToolBm25Index {
  private mini: MiniSearch<ToolBm25Doc>
  private readonly boost: Record<'name' | 'human' | 'aliases' | 'title', number>

  constructor(options: ToolBm25IndexOptions = {}) {
    this.boost = { ...DEFAULT_BOOST, ...options.boost }
    this.mini = this.createEmpty()
  }

  get size(): number {
    return this.mini.documentCount
  }

  /** 全量替换（build / replace / markReady hydrate） */
  replace(tools: readonly ToolBm25IndexInput[]): void {
    this.mini = this.createEmpty()
    const docs: ToolBm25Doc[] = []
    for (const t of tools) {
      const d = toolBm25Doc(t)
      if (d) docs.push(d)
    }
    if (docs.length > 0) this.mini.addAll(docs)
  }

  /** 差量 upsert（同 id 先删后加） */
  upsert(tools: readonly ToolBm25IndexInput[]): void {
    for (const t of tools) {
      const d = toolBm25Doc(t)
      if (!d) continue
      if (this.mini.has(d.id)) this.mini.discard(d.id)
      this.mini.add(d)
    }
  }

  /** 差量下线 */
  remove(ids: readonly string[]): void {
    for (const id of ids) {
      if (this.mini.has(id)) this.mini.discard(id)
    }
  }

  /**
   * 检索：按 BM25 分降序；可限制在候选集合内。
   * 空 query / 无文档 → []。
   */
  search(query: string, options: { topK?: number; candidates?: ReadonlySet<string> } = {}): ToolBm25Hit[] {
    const q = query.trim()
    if (!q || this.mini.documentCount === 0) return []
    const topK = options.topK ?? 24
    const candidates = options.candidates
    const raw = this.mini.search(q, {
      boost: this.boost,
      prefix: false,
      fuzzy: false,
      filter: candidates ? (result) => candidates.has(String(result.id)) : undefined,
    })
    return raw.slice(0, topK).map((r) => ({ id: String(r.id), score: r.score }))
  }

  private createEmpty(): MiniSearch<ToolBm25Doc> {
    return new MiniSearch<ToolBm25Doc>({
      fields: ['name', 'human', 'aliases', 'title'],
      storeFields: ['id'],
      idField: 'id',
      tokenize: tokenizeForBm25,
      processTerm: (term) => term.toLowerCase(),
      searchOptions: {
        tokenize: tokenizeForBm25,
        processTerm: (term) => term.toLowerCase(),
      },
    })
  }
}

/** Reciprocal Rank Fusion：多路排名加权合并（无需校准分数量纲） */
export function reciprocalRankFusion(
  rankedLists: ReadonlyArray<{ ids: readonly string[]; weight?: number }>,
  options: { rrfK?: number; topK: number },
): string[] {
  const rrfK = options.rrfK ?? 60
  const scores = new Map<string, number>()
  for (const list of rankedLists) {
    const w = list.weight ?? 1
    list.ids.forEach((id, rank) => {
      scores.set(id, (scores.get(id) ?? 0) + w / (rrfK + rank + 1))
    })
  }
  return [...scores.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, options.topK)
    .map(([id]) => id)
}
