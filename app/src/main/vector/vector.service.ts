import { Injectable } from '@electrum/common'
import { app } from 'electron'
import { join } from 'node:path'

export interface VectorTableColumn {
  name: string
  type: string
}
export interface VectorTableInfo {
  name: string
  count: number
  columns: VectorTableColumn[]
}
export interface VectorBrowseResult {
  total: number
  rows: Record<string, unknown>[]
}
/** 向量 + BM25 加权命中：展示向量 / 词法两路分 + RRF 融合分（与渲染端 ipc-api 对齐） */
export interface VectorHybridSearchHit {
  id: string
  content: string
  summary: string | null
  scope: string
  ownerId: string
  kind: string
  meta: Record<string, unknown>
  /** 余弦相似度；该行未达向量路阈值（或仅词法命中）时为 null */
  vectorScore: number | null
  /** BM25 词法得分（工具名 / 别名 / title）；词法路未命中时为 null */
  bm25Score: number | null
  /** RRF 融合权重分（决定返回顺序） */
  fusedScore: number
  /** 命中来源：参与融合的路 */
  sources: Array<'vector' | 'bm25'>
}

/**
 * 工具索引落地目录：必须与 `chat.service.ts` 的 `toolIndexDataDir()` 保持一致。
 * LanceDB 数据集落在 userData/forge/vector。
 */
const TOOL_INDEX_TABLE = 'tool_index'
const toolIndexDataDir = () => join(app.getPath('userData'), 'forge', 'vector')

/** 本地嵌入缓存：与 chat.service.ts 的 hfCacheDir() 一致，避免重复下载权重 */
const hfCacheDir = () => join(app.getPath('userData'), 'forge', 'hf-cache')
/** 国内默认走 hf-mirror，可用 CHATVEIN_HF_ENDPOINT / HF_ENDPOINT 覆盖 */
const hfRemoteHost = () =>
  process.env.CHATVEIN_HF_ENDPOINT?.trim() ||
  process.env.HF_ENDPOINT?.trim() ||
  'https://hf-mirror.com/'

@Injectable()
export class VectorService {
  /** 进程级复用嵌入器（首次调用才真正加载 ONNX 权重） */
  private embedder: import('@chatvein/vector').EmbeddingProvider | null = null

  private async openStore() {
    const vector = await import('@chatvein/vector')
    return vector.createLocalVectorStore({
      dataDir: toolIndexDataDir(),
      tableName: TOOL_INDEX_TABLE,
      // 只读浏览：无需嵌入器，避免为「查看」而加载 ONNX / lancedb 原生嵌入
    })
  }

  /** 列出数据集内的全部表及其结构（数据库浏览器用） */
  async inspectTables(): Promise<VectorTableInfo[]> {
    try {
      const store = await this.openStore()
      const tables = await store.inspectTables()
      await store.close()
      return tables
    } catch (e) {
      console.warn('[vector] inspectTables 读取失败（数据集可能尚未建立）：', (e as Error)?.message)
      return []
    }
  }

  /** 分页浏览某张表的记录 */
  async browseTable(name: string, limit = 50, offset = 0): Promise<VectorBrowseResult> {
    try {
      const store = await this.openStore()
      const res = await store.browseTable(name, { limit, offset })
      await store.close()
      return res
    } catch (e) {
      console.warn('[vector] browseTable 读取失败：', (e as Error)?.message)
      return { total: 0, rows: [] }
    }
  }

  /**
   * 语义检索 tool_index（当前唯一含向量列的表；其余表返回空）。
   * query → bge-small-zh 本地嵌入 → 余弦全表排序 → 按 minScore 截断：
   * score ≈ 余弦相似度 ∈ [-1,1]，默认 0.2 起滤除「弱相关以下」的命中。
   * topK 缺省（或 ≤0）时以总行数为召回上限，即返回所有 ≥ minScore 的记录，
   * 便于 UI 展示「符合阈值 N 条 / 共 M 条」。
   * 首次调用会加载（必要时经 hf-mirror 下载）本地嵌入模型；失败抛错交由 UI 提示。
   */
  async searchTable(
    name: string,
    query: string,
    topK = 0,
    minScore = 0,
  ): Promise<import('@chatvein/vector').VectorSearchHit[]> {
    const q = query.trim()
    if (!q || name !== TOOL_INDEX_TABLE) return []
    const vector = await import('@chatvein/vector')
    this.embedder ??= vector.createBgeZhEmbedder({ cacheDir: hfCacheDir(), remoteHost: hfRemoteHost() })
    const store = vector.createLocalVectorStore({
      dataDir: toolIndexDataDir(),
      tableName: TOOL_INDEX_TABLE,
      embedder: this.embedder,
    })
    try {
      const total = await store.count()
      const cap = Math.max(total, 1)
      const k = topK && topK > 0 ? Math.min(topK, cap) : cap
      const hits = await store.search(q, { topK: k })
      return hits.filter((h) => h.score >= minScore)
    } finally {
      await store.close()
    }
  }

  /**
   * 向量 + BM25 加权检索（对齐对话工具预筛 C1 的混合召回，供 UI「向量+BM25加权」比对）。
   * 向量路：query → bge 本地嵌入 → 全表余弦，按 minScore 截断；
   * BM25 路：按 tool_index 行重建进程内 `ToolBm25Index`（工具名 / 人类名 / 目录 keywords
   * 别名 / title），精确命中的词法路**不受 minScore 截断**——与 C1 一致（阈值只作用于向量路），
   * 因此「名称/别名命中但向量分低」的工具仍会被召回并靠前。
   * 融合：RRF（vectorWeight=1、lexicalWeight=1.25、rrfK=60，即 @chatvein/tools 默认），
   * 结果按 RRF 融合权重分降序返回。
   */
  async hybridSearchTable(
    name: string,
    query: string,
    topK = 0,
    minScore = 0,
  ): Promise<VectorHybridSearchHit[]> {
    const q = query.trim()
    if (!q || name !== TOOL_INDEX_TABLE) return []
    const vector = await import('@chatvein/vector')
    const tools = await import('@chatvein/tools')
    this.embedder ??= vector.createBgeZhEmbedder({ cacheDir: hfCacheDir(), remoteHost: hfRemoteHost() })
    const store = vector.createLocalVectorStore({
      dataDir: toolIndexDataDir(),
      tableName: TOOL_INDEX_TABLE,
      embedder: this.embedder,
    })
    try {
      const total = await store.count()
      if (total === 0) return []
      const cap = Math.max(total, 1)
      const k = topK && topK > 0 ? Math.min(topK, cap) : cap

      // 1) 向量路（C1 同款：阈值只过滤向量路）
      const vecHits = await store.search(q, { topK: k })
      const vecFiltered = vecHits.filter((h) => h.score >= minScore)

      // 2) BM25 路：工具全集按行重建内存索引（目录条目 id 与工具名一致，
      //    未收录的自定义 MCP 工具退化为用行摘要/内容充当 description）
      const rows = await this.listAllRows(store)
      const bm25 = new tools.ToolBm25Index()
      bm25.replace(rows.map((r) => ({ name: r.id, description: r.summary || r.content })))
      const lexHits = bm25.search(q, { topK: cap })

      // 3) RRF 加权融合（与 @chatvein/tools#reciprocalRankFusion 同参，此处另算分供展示/排序）
      const RRF_K = 60
      const fused = new Map<string, number>()
      vecFiltered.forEach((h, i) => fused.set(h.id, (fused.get(h.id) ?? 0) + 1 / (RRF_K + i + 1)))
      lexHits.forEach((h, i) => fused.set(h.id, (fused.get(h.id) ?? 0) + 1.25 / (RRF_K + i + 1)))

      const vecById = new Map(vecFiltered.map((h) => [h.id, h]))
      const lexScoreById = new Map(lexHits.map((h) => [h.id, h.score]))
      const rowById = new Map(rows.map((r) => [r.id, r]))

      const out: VectorHybridSearchHit[] = []
      for (const [id, fusedScore] of fused) {
        const vh = vecById.get(id)
        const lexScore = lexScoreById.get(id)
        const row = rowById.get(id)
        if (!row) continue
        const sources: Array<'vector' | 'bm25'> = []
        if (vh) sources.push('vector')
        if (lexScore != null) sources.push('bm25')
        out.push({
          id,
          content: vh?.content ?? row.content,
          summary: vh?.summary ?? row.summary,
          scope: vh?.scope ?? row.scope,
          ownerId: vh?.ownerId ?? row.ownerId,
          kind: vh?.kind ?? row.kind,
          meta: vh?.meta ?? row.meta,
          vectorScore: vh?.score ?? null,
          bm25Score: lexScore ?? null,
          fusedScore,
          sources,
        })
      }
      return out.sort(
        (a, b) =>
          b.fusedScore - a.fusedScore ||
          (b.vectorScore ?? -2) - (a.vectorScore ?? -2) ||
          a.id.localeCompare(b.id),
      )
    } finally {
      await store.close()
    }
  }

  /** 逐页拉取整表行（工具集规模很小；循环仅为防御性处理 list 单页上限） */
  private async listAllRows(
    store: import('@chatvein/vector').LocalVectorStore,
  ): Promise<import('@chatvein/vector').VectorListRow[]> {
    const out: import('@chatvein/vector').VectorListRow[] = []
    let offset = 0
    for (;;) {
      const page = await store.list({ limit: 2000, offset })
      out.push(...page)
      if (page.length < 2000) return out
      offset += page.length
    }
  }
}
