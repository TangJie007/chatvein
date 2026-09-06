import { Injectable } from '@electrum/common'
import { tmpdir } from 'node:os'
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
 * 该 LanceDB 数据集在对话首次触发工具选用时懒建，落在系统临时目录。
 */
const TOOL_INDEX_TABLE = 'tool_index'
const toolIndexDataDir = () => join(tmpdir(), 'chatvein-tool-index')

@Injectable()
export class VectorService {
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
}
