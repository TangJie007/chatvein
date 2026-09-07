/**
 * tool_index 数据集索引元信息。
 *
 * 与 LanceDB 表同目录落盘（`chatvein-tool-index/index-meta.json`），作为
 * 「版本化全量基准 + 运行期差量同步」的单一真相源：
 *
 * - `builtinSignature`：最近一次成功全量（warmup）写入的工具记录内容签名。
 *   启动时对当前工具全集重新求签名，一致 → 跳过；不一致 → 全量覆盖 + 清理下线。
 * - `syncedNames`：已知已入库的工具名清单（warmup 全量 ∪ 运行期差量并集）。
 */
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { dirname, join } from 'node:path'

export interface ToolIndexMeta {
  builtinSignature?: string
  syncedNames?: string[]
  updatedAt?: number
}

/**
 * 工具记录 → 内容签名：按 id 稳定排序后逐条聚合 (id, content) 的 sha256。
 *
 * 纯内容层（不涉及向量 / 嵌入模型），因此 catalog 描述、关键词、schema 参数名
 * 或工具名任何变化都会使签名改变，而向量语义未变的场景不会误重建。
 */
export function toolIndexSignature(
  records: readonly { id: string; content?: string }[],
): string {
  const h = createHash('sha256')
  const sorted = [...records].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
  for (const r of sorted) {
    h.update(r.id)
    h.update('\u0000')
    h.update(r.content ?? '')
    h.update('\u0000')
  }
  return h.digest('hex')
}

/** 默认 meta 文件路径：与 LanceDB 数据集同目录 */
export function toolIndexMetaFile(dataDir: string): string {
  return join(dataDir, 'index-meta.json')
}

export class ToolIndexMetaStore {
  constructor(private readonly file: string) {}

  /** 读取（不存在 / 损坏 → 空元信息，不抛错） */
  async read(): Promise<ToolIndexMeta> {
    let raw: string
    try {
      raw = await fs.readFile(this.file, 'utf8')
    } catch {
      return {}
    }
    try {
      const obj = JSON.parse(raw) as Record<string, unknown> | null
      return {
        builtinSignature:
          obj && typeof obj.builtinSignature === 'string' ? obj.builtinSignature : undefined,
        syncedNames:
          obj && Array.isArray(obj.syncedNames)
            ? (obj.syncedNames as unknown[]).filter((x): x is string => typeof x === 'string')
            : undefined,
        updatedAt:
          obj && typeof obj.updatedAt === 'number' ? obj.updatedAt : undefined,
      }
    } catch {
      return {}
    }
  }

  async write(meta: ToolIndexMeta): Promise<void> {
    await fs.mkdir(dirname(this.file), { recursive: true })
    await fs.writeFile(this.file, JSON.stringify(meta, null, 2), 'utf8')
  }
}
