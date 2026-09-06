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
  VectorKind,
  VectorRecord,
  VectorScope,
  VectorSearchFilter,
  VectorSearchHit,
  VectorSearchOptions,
} from './types'

const TABLE_NAME = 'vectors'

export interface LocalVectorStoreOptions {
  /**
   * LanceDB 目录 URI（本地路径）。
   * 省略则使用系统临时目录（适合测试；进程结束后可清理）。
   */
  dataDir?: string
  embedder: EmbeddingProvider
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
  private readonly embedder: EmbeddingProvider
  private readonly dataDir?: string
  private readonly tableName: string
  private resolvedUri: string | null = null

  constructor(options: LocalVectorStoreOptions) {
    this.embedder = options.embedder
    this.dataDir = options.dataDir
    this.tableName = options.tableName ?? TABLE_NAME
  }

  get modelId(): string {
    return this.embedder.modelId
  }

  get dimensions(): number {
    return this.embedder.dimensions
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
        ? await this.embedder.embedBatch(needEmbed.map((r) => r.content))
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
        embedding_model: this.embedder.modelId,
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
      : toNumberArray(await this.embedder.embed(query))

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
