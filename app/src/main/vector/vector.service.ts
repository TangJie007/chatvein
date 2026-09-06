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
}
