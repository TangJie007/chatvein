/**
 * ToolVectorIndex — 工具语义预筛（层 C1）：向量 + 工具名/别名 BM25 混合召回。
 *
 * 依赖注入「嵌入器 + 向量库」最小接口，自身**零硬依赖** `@chatvein/vector`，
 * 原生模块（onnxruntime / lancedb）只在装配侧（app / sidecar）按需加载。
 *
 * 建索引：候选工具 → `toolEmbedText` 成文 → embedder 嵌入 → store.upsert（scope=tool）
 *         同时进程内重建 MiniSearch（name / human / aliases / title）
 * 检索：  向量路 + BM25 路 → RRF 融合 → 候选内 Top-K（`max(prescreenTopK, 候选数)`）。
 * 未就绪 / 无命中 → `select` 返回 []，由上层回退关键词或全候选（full）。
 */
import { toolEmbedText, type ToolEmbedInput } from './tool-embed'
import { ToolBm25Index, reciprocalRankFusion } from './tool-bm25-index'

/** 索引域：与记忆隔离，专用工具描述 */
export const TOOL_INDEX_SCOPE = 'tool'
export const TOOL_INDEX_KIND = 'tool_desc'

/** C1 混合预筛默认召回上限（select 未传 topK / 未配 opts 时） */
export const TOOL_PRESCREEN_TOP_K = 16

/**
 * 向量路默认相似度阈值（score≈1−cosineDistance）。
 * 默认 `0.45` 丢掉明显不相关命中后再进 RRF。
 */
export const TOOL_VECTOR_MIN_SCORE = 0.45

/** 嵌入器最小接口（@chatvein/vector 的 `EmbeddingProvider` 子集） */
export interface ToolEmbedder {
  readonly modelId: string
  readonly dimensions: number
  embed(text: string): Promise<Float32Array>
  embedBatch(texts: string[]): Promise<Float32Array[]>
}

/** 向量检索最小接口（@chatvein/vector 的 `LocalVectorStore` 子集） */
export interface ToolVectorStore {
  upsert(records: readonly ToolIndexRecord[]): Promise<string[]>
  search(query: string, options?: ToolIndexSearchOptions): Promise<ToolIndexHit[]>
  /**
   * 按 id 批量删除（幂等），返回实际删除条数。
   * 用于目录下线清理 / 全量重建时的陈旧行。
   */
  remove(ids: readonly string[]): Promise<number>
}

export interface ToolIndexRecord {
  id: string
  content: string
  scope?: string
  kind?: string
  meta?: Record<string, unknown>
}

export interface ToolIndexSearchOptions {
  topK?: number
  queryEmbedding?: Float32Array | number[]
}

export interface ToolIndexHit {
  id: string
  score: number
  meta?: Record<string, unknown>
}

/** 建索引输入：LangChain 工具实例可无损映射（name + description + schema） */
export interface ToolVectorIndexInput {
  name: string
  description?: string
  schema?: unknown
}

export interface ToolVectorIndexOptions {
  embedder: ToolEmbedder
  store: ToolVectorStore
  /** 混合预筛召回上限（粗召回给弱模精筛），默认 `TOOL_PRESCREEN_TOP_K` */
  prescreenTopK?: number
  /**
   * 向量路相似度阈值（score≈1−cosineDistance）；低于不进融合。
   * 默认 `TOOL_VECTOR_MIN_SCORE`；显式传 `0` 表示不过滤。
   */
  minScore?: number
  /** RRF 常数，默认 60 */
  rrfK?: number
  /** 向量路 RRF 权重，默认 1 */
  vectorWeight?: number
  /** BM25（工具名/别名）路 RRF 权重，默认 1.25（偏强信号） */
  lexicalWeight?: number
  /** 工具名 → 嵌入文本（默认 toolEmbedText）；可注入便于测试 */
  embedText?: (input: ToolEmbedInput) => string
}

/**
 * 工具向量索引：一次版本化全量基准 + 运行期差量同步，per-turn 混合召回 Top-K 候选。
 *
 * - `build()`：首次全量建索引（幂等，`ready` 后短路）。
 * - `replace()`：版本化全量重建（目录 / 嵌入内容变化时覆盖写并标记 ready）。
 * - `sync()` / `purge()`：差量原语，绕过 built 闸门，不改变 ready 状态。
 * - `markReady(tools?)`：磁盘签名命中跳过写库时标记 ready；须传入 tools 以 hydrate BM25。
 *
 * 线程安全：build 幂等、可并发重入；select 在未 ready 时返回 []（调用方回退）。
 */
export class ToolVectorIndex {
  private built = false
  private building: Promise<void> | null = null
  private readonly embedText: (input: ToolEmbedInput) => string
  private readonly lexical = new ToolBm25Index()

  constructor(private readonly opts: ToolVectorIndexOptions) {
    this.embedText = opts.embedText ?? toolEmbedText
  }

  get ready(): boolean {
    return this.built
  }

  get modelId(): string {
    return this.opts.embedder.modelId
  }

  /** 测试 / 诊断：进程内 BM25 文档数 */
  get lexicalSize(): number {
    return this.lexical.size
  }

  /**
   * 磁盘索引已与内容签名一致、无需重写时：仅标记进程内 ready。
   * 启动 warmup 零成本跳过路径必须调用，并传入当前工具全集以 hydrate 内存 BM25，
   * 否则 `built` 为 true 但别名路为空，混合检索退化为纯向量。
   */
  markReady(tools?: readonly ToolVectorIndexInput[]): void {
    if (tools && tools.length > 0) this.lexical.replace(tools)
    this.built = true
    this.building = null
  }

  /**
   * 把工具实例（name/description/schema）翻译成入库记录。
   * 纯文本层、同步、不触发嵌入；用于调用方计算版本签名或喂给 `sync()`。
   */
  recordsFor(tools: readonly ToolVectorIndexInput[]): ToolIndexRecord[] {
    const records: ToolIndexRecord[] = []
    for (const t of tools) {
      if (!t.name) continue
      const content = this.embedText({ name: t.name, description: t.description, schema: t.schema })
      if (!content) continue
      records.push({
        id: t.name,
        content,
        scope: TOOL_INDEX_SCOPE,
        kind: TOOL_INDEX_KIND,
        meta: { name: t.name },
      })
    }
    return records
  }

  /** 异步建索引；幂等、可并发重入；失败清除 building 标记并抛出，由调用方决定回退 */
  async build(tools: readonly ToolVectorIndexInput[]): Promise<void> {
    if (this.built) return
    if (this.building) return this.building
    this.building = this.doBuild(tools).then(
      () => {
        this.built = true
      },
      (err) => {
        this.building = null
        throw err
      },
    )
    return this.building
  }

  private async doBuild(tools: readonly ToolVectorIndexInput[]): Promise<void> {
    this.lexical.replace(tools)
    await this.sync(this.recordsFor(tools))
  }

  /**
   * 差量补录：新增 / 变更工具直接 upsert（同 id 幂等覆盖）。
   * 不修改 ready 状态，可独立于 `build()`/`replace()` 使用。
   */
  async sync(records: readonly ToolIndexRecord[]): Promise<string[]> {
    if (records.length === 0) return []
    this.lexical.upsert(records.map((r) => ({ name: r.id, description: r.content })))
    return this.opts.store.upsert(records)
  }

  /** 差量下线：按 id 批量删除；不修改 ready 状态 */
  async purge(ids: readonly string[]): Promise<number> {
    if (ids.length === 0) return 0
    this.lexical.remove(ids)
    return this.opts.store.remove(ids)
  }

  /**
   * 版本化全量重建：无条件覆盖写并标记 ready。
   * 目录 / 嵌入文本内容变化（版本签名不符）时调用；同 id 覆盖、其余由调用方 purge。
   */
  async replace(tools: readonly ToolVectorIndexInput[]): Promise<void> {
    await this.doBuild(tools)
    this.built = true
  }

  /**
   * 混合预筛：向量相似度 + 工具名/别名 BM25 → RRF → 候选内 Top-K。
   * 未就绪 / 空 query / 无候选 → 返回 []（上层回退）。
   *
   * 召回上限：`Math.max(topK, candidateNames.length)`（与改混合前一致，用候选数抬高）。
   */
  async select(
    query: string,
    candidateNames: readonly string[],
    topK: number = this.opts.prescreenTopK ?? TOOL_PRESCREEN_TOP_K,
  ): Promise<string[]> {
    if (!this.built || !query.trim() || candidateNames.length === 0) return []
    const limit = Math.max(topK, candidateNames.length)
    const candidates = new Set(candidateNames)
    const min = this.opts.minScore ?? TOOL_VECTOR_MIN_SCORE

    const vectorRanked = await this.vectorRank(query, candidates, limit, min)
    const lexicalRanked = this.lexical
      .search(query, { topK: limit, candidates })
      .map((h) => h.id)

    if (vectorRanked.length === 0 && lexicalRanked.length === 0) return []

    return reciprocalRankFusion(
      [
        { ids: vectorRanked, weight: this.opts.vectorWeight ?? 1 },
        { ids: lexicalRanked, weight: this.opts.lexicalWeight ?? 1.25 },
      ],
      { rrfK: this.opts.rrfK ?? 60, topK: limit },
    )
  }

  private async vectorRank(
    query: string,
    candidates: ReadonlySet<string>,
    fetchK: number,
    minScore: number,
  ): Promise<string[]> {
    try {
      const hits = await this.opts.store.search(query, { topK: fetchK })
      return hits
        .filter((h) => h.score >= minScore && candidates.has(h.id))
        .map((h) => h.id)
    } catch {
      return []
    }
  }
}
