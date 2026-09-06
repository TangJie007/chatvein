/** @chatvein/vector 公共类型 */

export interface EmbeddingProvider {
  /** 模型标识（配置/索引元数据） */
  readonly modelId: string
  /** 向量维度（换模型须重建索引） */
  readonly dimensions: number
  embed(text: string): Promise<Float32Array>
  embedBatch(texts: string[]): Promise<Float32Array[]>
}

export type VectorScope = 'personal' | 'group' | 'global' | 'code' | 'tool'

export type VectorKind = 'memory' | 'message' | 'code' | 'doc' | 'decision' | 'tool_desc'

export interface VectorRecord {
  id: string
  content: string
  scope?: VectorScope
  ownerId?: string
  kind?: VectorKind
  summary?: string
  meta?: Record<string, unknown>
  /** 若省略，由 store 用 EmbeddingProvider 生成 */
  embedding?: Float32Array | number[]
}

export interface StoredVector extends Required<Pick<VectorRecord, 'id' | 'content'>> {
  scope: VectorScope
  ownerId: string
  kind: VectorKind
  summary: string | null
  meta: Record<string, unknown>
  embedding: Float32Array
  createdAt: number
  updatedAt: number
}

export interface VectorSearchFilter {
  scope?: VectorScope | VectorScope[]
  ownerId?: string
  kind?: VectorKind | VectorKind[]
}

export interface VectorSearchOptions {
  topK?: number
  filter?: VectorSearchFilter
  /** 直接传向量则跳过嵌入 */
  queryEmbedding?: Float32Array | number[]
}

export interface VectorSearchHit {
  id: string
  content: string
  summary: string | null
  score: number
  scope: VectorScope
  ownerId: string
  kind: VectorKind
  meta: Record<string, unknown>
}
