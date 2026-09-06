/** @chatvein/vector 公共类型 */

export interface EmbeddingProvider {
  /** 模型标识（配置/索引元数据） */
  readonly modelId: string
  /** 向量维度（换模型须重建索引） */
  readonly dimensions: number
  embed(text: string): Promise<Float32Array>
  embedBatch(texts: string[]): Promise<Float32Array[]>
}

/**
 * 向量归属域（谁能看见 / 与哪类主体绑定；检索可按 scope 过滤）。
 * - personal：个人记忆/偏好等，owner ≈ 用户或角色
 * - group：群组共享，owner ≈ groupId
 * - global：全局共享（默认）
 * - code：代码库/工作区索引，owner ≈ repo/workspace
 * - tool：工具目录索引域（与记忆隔离；条目 kind 多为 tool_desc）
 */
export type VectorScope = 'personal' | 'group' | 'global' | 'code' | 'tool'

/**
 * 向量内容种类（一条记了什么；与 scope 正交）。
 * - memory：长期语义记忆（事实/偏好）
 * - message：对话消息片段
 * - code：源码/符号块
 * - doc：文档/通用文本（store 缺省 kind）
 * - decision：决策/结论类提炼
 * - tool_desc：工具描述（供 Top-K 选型；嵌入文案如 mcpToolEmbedText）
 */
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

/**
 * 列举选项（只读遍历，不走向量检索；用于「查看索引里存了什么」类场景）。
 */
export interface VectorListOptions {
  filter?: VectorSearchFilter
  /** 单页上限，默认 200，最大 2000 */
  limit?: number
  /** 游标偏移（lancedb 支持） */
  offset?: number
}

/**
 * 一条已存向量的明细（不含向量本体，避免大负载；维度以 `dimensions` 暴露）。
 */
export interface VectorListRow {
  id: string
  content: string
  summary: string | null
  scope: VectorScope
  ownerId: string
  kind: VectorKind
  meta: Record<string, unknown>
  embeddingModel: string
  dimensions: number
  createdAt: number
  updatedAt: number
}

/** 数据集内一张表的概览：表名 + 行数 + 列结构（数据库浏览器用） */
export interface VectorTableInfo {
  name: string
  count: number
  columns: { name: string; type: string }[]
}

/** 浏览某表一页的返回：总行数 + 本页记录（向量列折叠为维度，meta_json 解析为对象） */
export interface VectorBrowseResult {
  total: number
  rows: Record<string, unknown>[]
}
