/**
 * ToolVectorIndex — 工具语义预筛（层 C1 升级版）。
 *
 * 依赖注入「嵌入器 + 向量库」最小接口，自身**零硬依赖** `@chatvein/vector`，
 * 原生模块（onnxruntime / lancedb）只在装配侧（app / sidecar）按需加载。
 *
 * 建索引：候选工具 → `toolEmbedText` 成文 → embedder 嵌入 → store.upsert（scope=tool）
 * 检索：  query → store.search（scope=tool）→ 候选内的 Top-K 工具名。
 * 未就绪 / 无命中 → `select` 返回 []，由上层回退全候选（full）。
 */
import { toolEmbedText, type ToolEmbedInput } from './tool-embed'

/** 索引域：与记忆隔离，专用工具描述 */
export const TOOL_INDEX_SCOPE = 'tool'
export const TOOL_INDEX_KIND = 'tool_desc'

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
  /** 语义预筛召回上限（粗召回给 L2 精筛），默认 24 */
  prescreenTopK?: number
  /** 相似度阈值（score≈1-cosineDistance）；低于视为不相关 → 走回退，默认 0（不过滤） */
  minScore?: number
  /** 工具名 → 嵌入文本（默认 toolEmbedText）；可注入便于测试 */
  embedText?: (input: ToolEmbedInput) => string
}

/**
 * 工具向量索引：建一次，per-turn 语义召回 Top-K 候选。
 *
 * 线程安全：build 幂等、可并发重入；select 在未 ready 时返回 []（调用方回退）。
 */
export class ToolVectorIndex {
  private built = false
  private building: Promise<void> | null = null
  private readonly embedText: (input: ToolEmbedInput) => string

  constructor(private readonly opts: ToolVectorIndexOptions) {
    this.embedText = opts.embedText ?? toolEmbedText
  }

  get ready(): boolean {
    return this.built
  }

  get modelId(): string {
    return this.opts.embedder.modelId
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
    if (records.length === 0) return
    await this.opts.store.upsert(records)
  }

  /**
   * 语义预筛：query → 候选内的 Top-K 工具名。
   * 未就绪 / 空 query / 无候选 → 返回 []（上层回退全候选）。
   */
  async select(
    query: string,
    candidateNames: readonly string[],
    topK: number = this.opts.prescreenTopK ?? 24,
  ): Promise<string[]> {
    if (!this.built || !query.trim() || candidateNames.length === 0) return []
    const min = this.opts.minScore ?? 0
    const candidates = new Set(candidateNames)
    const hits = await this.opts.store.search(query, {
      topK: Math.max(topK, candidateNames.length),
    })
    return hits.filter((h) => h.score >= min && candidates.has(h.id)).map((h) => h.id)
  }
}
