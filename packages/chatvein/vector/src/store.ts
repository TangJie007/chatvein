/**
 * 进程内向量库：LanceDB 持久化 + 原生向量检索（cosine）。
 */
import { connect, type Connection, type Table } from '@lancedb/lancedb'
import { createHash } from 'node:crypto'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { EmbeddingProvider } from './types'
import type {
  StoredVector,
  VectorBrowseResult,
  VectorKind,
  VectorListOptions,
  VectorListRow,
  VectorRecord,
  VectorScope,
  VectorSearchFilter,
  VectorSearchHit,
  VectorTableInfo,
  VectorSearchOptions,
} from './types'

const TABLE_NAME = 'vectors'

export interface LocalVectorStoreOptions {
  /**
   * LanceDB 目录 URI（本地路径）。
   * 省略则使用系统临时目录（适合测试；进程结束后可清理）。
   */
  dataDir?: string
  /**
   * 嵌入器。只读列举（`list`）/计数（`count`）可不传；写入（`upsert`）与语义检索（`search`）必需。
   */
  embedder?: EmbeddingProvider
  /** 表名，默认 `vectors` */
  tableName?: string
}

type LanceRow = {
  id: string
  vector: number[] | Float32Array
  content: string
  summary: string
  scope: string
  owner_id: string
  kind: string
  meta_json: string
  embedding_model: string
  created_at: number
  updated_at: number
  _distance?: number
}

export class LocalVectorStore {
  private conn: Connection | null = null
  private table: Table | null = null
  private readonly embedder?: EmbeddingProvider
  private readonly dataDir?: string
  private readonly tableName: string
  private resolvedUri: string | null = null

  constructor(options: LocalVectorStoreOptions) {
    this.embedder = options.embedder
    this.dataDir = options.dataDir
    this.tableName = options.tableName ?? TABLE_NAME
  }

  get modelId(): string {
    return this.embedder?.modelId ?? ''
  }

  get dimensions(): number {
    return this.embedder?.dimensions ?? 0
  }

  /** 实际连接 URI（init 后可用） */
  get uri(): string | null {
    return this.resolvedUri
  }

  async init(): Promise<void> {
    if (this.conn) return
    this.resolvedUri =
      this.dataDir?.trim() || (await mkdtemp(join(tmpdir(), 'chatvein-lancedb-')))
    this.conn = await connect(this.resolvedUri)
    const names = await this.conn.tableNames()
    if (names.includes(this.tableName)) {
      this.table = await this.conn.openTable(this.tableName)
    }
  }

  async close(): Promise<void> {
    this.table = null
    // LanceDB Connection 无强制 close；释放引用即可
    this.conn = null
  }

  /** 内容寻址 id（未显式给 id 时） */
  static contentId(content: string, scope: string, kind: string): string {
    return createHash('sha256').update(`${scope}:${kind}:${content}`).digest('hex').slice(0, 32)
  }

  async upsert(records: VectorRecord | VectorRecord[]): Promise<string[]> {
    await this.init()
    const list = Array.isArray(records) ? records : [records]
    if (list.length === 0) return []

    const now = Date.now()
    const needEmbed = list.filter((r) => !r.embedding)
    const embedded =
      needEmbed.length > 0
        ? await this.embedder!.embedBatch(needEmbed.map((r) => r.content))
        : []
    let embedIdx = 0

    const rows: LanceRow[] = []
    const ids: string[] = []
    for (const r of list) {
      const scope = (r.scope ?? 'global') as VectorScope
      const kind = (r.kind ?? 'doc') as VectorKind
      const ownerId = r.ownerId ?? 'global'
      const id = r.id || LocalVectorStore.contentId(r.content, scope, kind)
      const emb = r.embedding ? toNumberArray(r.embedding) : toNumberArray(embedded[embedIdx++]!)
      rows.push({
        id,
        vector: emb,
        content: r.content,
        summary: r.summary ?? '',
        scope,
        owner_id: ownerId,
        kind,
        meta_json: JSON.stringify(r.meta ?? {}),
        embedding_model: this.embedder!.modelId,
        created_at: now,
        updated_at: now,
      })
      ids.push(id)
    }

    if (!this.table) {
      this.table = await this.conn!.createTable(this.tableName, rows, { mode: 'create' })
    } else {
      await this.table
        .mergeInsert('id')
        .whenMatchedUpdateAll()
        .whenNotMatchedInsertAll()
        .execute(rows)
    }
    return ids
  }

  async search(query: string, options: VectorSearchOptions = {}): Promise<VectorSearchHit[]> {
    await this.init()
    if (!this.table) return []

    const topK = options.topK ?? 8
    const qEmb = options.queryEmbedding
      ? toNumberArray(options.queryEmbedding)
      : toNumberArray(await this.embedder!.embed(query))

    let q = this.table.vectorSearch(qEmb).distanceType('cosine').limit(topK)
    const predicate = buildFilterPredicate(options.filter)
    if (predicate) q = q.where(predicate)

    const rows = (await q.toArray()) as LanceRow[]
    return rows.map((row) => {
      const distance = typeof row._distance === 'number' ? row._distance : 0
      return {
        id: row.id,
        content: row.content,
        summary: row.summary || null,
        // cosine distance ≈ 1 - similarity（向量已归一化时）
        score: 1 - distance,
        scope: row.scope as VectorScope,
        ownerId: row.owner_id,
        kind: row.kind as VectorKind,
        meta: parseMeta(row.meta_json),
      }
    })
  }

  async get(id: string): Promise<StoredVector | null> {
    await this.init()
    if (!this.table) return null
    const rows = (await this.table
      .query()
      .where(`id = ${sqlString(id)}`)
      .limit(1)
      .toArray()) as LanceRow[]
    const row = rows[0]
    if (!row) return null
    return {
      id: row.id,
      content: row.content,
      summary: row.summary || null,
      scope: row.scope as VectorScope,
      ownerId: row.owner_id,
      kind: row.kind as VectorKind,
      meta: parseMeta(row.meta_json),
      embedding: Float32Array.from(row.vector),
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }
  }

  async delete(id: string): Promise<boolean> {
    await this.init()
    if (!this.table) return false
    const before = await this.table.countRows(`id = ${sqlString(id)}`)
    if (before === 0) return false
    await this.table.delete(`id = ${sqlString(id)}`)
    return true
  }

  async count(filter?: VectorSearchFilter): Promise<number> {
    await this.init()
    if (!this.table) return 0
    const predicate = buildFilterPredicate(filter)
    return predicate ? this.table.countRows(predicate) : this.table.countRows()
  }

  /**
   * 只读遍历：列出已存向量明细（不含向量本体）。用于「查看索引里存了什么」。
   * 不走语义检索、不需要 embedder；表不存在时返回空数组。
   */
  async list(options: VectorListOptions = {}): Promise<VectorListRow[]> {
    await this.init()
    if (!this.table) return []
    const limit = Math.min(Math.max(options.limit ?? 200, 1), 2000)
    let q = this.table.query().limit(limit)
    const predicate = buildFilterPredicate(options.filter)
    if (predicate) q = q.where(predicate)
    if (options.offset && options.offset > 0) {
      q = (q as unknown as { offset: (n: number) => typeof q }).offset(options.offset)
    }
    const rows = (await q.toArray()) as LanceRow[]
    return rows.map((row) => ({
      id: row.id,
      content: row.content,
      summary: row.summary || null,
      scope: row.scope as VectorScope,
      ownerId: row.owner_id,
      kind: row.kind as VectorKind,
      meta: parseMeta(row.meta_json),
      embeddingModel: row.embedding_model,
      dimensions: Array.isArray(row.vector) ? row.vector.length : (row.vector as Float32Array)?.length ?? 0,
      createdAt: Number(row.created_at),
      updatedAt: Number(row.updated_at),
    }))
  }

  /**
   * 数据集浏览器：列出全部表（表名 + 行数 + 列结构）。
   * 数据集为空目录 / 不存在 → 返回 []（不抛错）。
   */
  async inspectTables(): Promise<VectorTableInfo[]> {
    await this.init()
    if (!this.conn) return []
    try {
      const names = await this.conn.tableNames()
      const out: VectorTableInfo[] = []
      for (const name of names) {
        try {
          const t = await this.conn.openTable(name)
          const total = await t.countRows()
          const schema = await t.schema()
          const columns = (schema?.fields ?? []).map((f) => ({
            name: f.name,
            type: f.type != null ? String(f.type) : 'unknown',
          }))
          out.push({ name, count: total, columns })
        } catch {
          // 个别表不可读则跳过
        }
      }
      return out
    } catch {
      return []
    }
  }

  /**
   * 浏览某张表的一页记录（向量列折叠为维度，meta_json 解析为对象）。
   * 不走语义检索、不需要 embedder；表不存在 / 读取失败 → 返回空结果。
   */
  async browseTable(
    table: string,
    options: { limit?: number; offset?: number } = {},
  ): Promise<VectorBrowseResult> {
    await this.init()
    if (!this.conn) return { total: 0, rows: [] }
    try {
      const t = await this.conn.openTable(table)
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 500)
      const offset = Math.max(options.offset ?? 0, 0)
      const total = await t.countRows()
      let q = t.query().limit(limit)
      if (offset > 0) {
        q = (q as unknown as { offset: (n: number) => typeof q }).offset(offset)
      }
      const raw = (await q.toArray()) as Array<Record<string, unknown>>
      return { total, rows: raw.map((row) => projectBrowseRow(row)) }
    } catch {
      return { total: 0, rows: [] }
    }
  }
}

export function createLocalVectorStore(options: LocalVectorStoreOptions): LocalVectorStore {
  return new LocalVectorStore(options)
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    const x = a[i]!
    const y = b[i]!
    dot += x * y
    na += x * x
    nb += y * y
  }
  if (na === 0 || nb === 0) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

function toNumberArray(v: Float32Array | number[]): number[] {
  return Array.from(v)
}

function parseMeta(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    return {}
  }
}

/** 浏览投影：向量列折叠为维度对象，meta_json 解析为对象（其余列保持原值） */
function projectBrowseRow(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(row)) {
    if (k === 'vector') {
      const dim = Array.isArray(v) ? v.length : (v as Float32Array)?.length ?? 0
      out[k] = { __vector: true, dimensions: dim }
      continue
    }
    if (k === 'meta_json' && typeof v === 'string') {
      try {
        out[k] = JSON.parse(v)
      } catch {
        out[k] = v
      }
      continue
    }
    out[k] = v
  }
  return out
}

/** SQL 字符串字面量（单引号转义） */
function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`
}

function buildFilterPredicate(filter?: VectorSearchFilter): string | undefined {
  if (!filter) return undefined
  const clauses: string[] = []

  if (filter.scope) {
    const scopes = Array.isArray(filter.scope) ? filter.scope : [filter.scope]
    clauses.push(`scope IN (${scopes.map(sqlString).join(', ')})`)
  }
  if (filter.ownerId) {
    clauses.push(`owner_id = ${sqlString(filter.ownerId)}`)
  }
  if (filter.kind) {
    const kinds = Array.isArray(filter.kind) ? filter.kind : [filter.kind]
    clauses.push(`kind IN (${kinds.map(sqlString).join(', ')})`)
  }

  return clauses.length ? clauses.join(' AND ') : undefined
}
