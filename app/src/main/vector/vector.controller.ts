import { Controller, IpcHandle, Inject } from '@electrum/common'
import { VectorService } from './vector.service'
import type { VectorBrowseResult, VectorTableInfo } from './vector.service'

@Controller('vector')
export class VectorController {
  @Inject(VectorService)
  private svc!: VectorService

  /** 列出向量数据集内的全部表及其结构（供设置页「向量数据库」浏览器） */
  @IpcHandle('inspectTables')
  inspectTables(): Promise<VectorTableInfo[]> {
    return this.svc.inspectTables()
  }

  /** 分页浏览某张表的记录 */
  @IpcHandle('browseTable')
  browseTable(name: string, limit?: number, offset?: number): Promise<VectorBrowseResult> {
    return this.svc.browseTable(name, limit, offset)
  }

  /** 语义检索 tool_index：自然语言 query → 本地嵌入 → 余弦 Top-K（minScore 截断相似度下限） */
  @IpcHandle('searchTable')
  searchTable(
    name: string,
    data: { query: string; topK?: number; minScore?: number },
  ): Promise<import('@chatvein/vector').VectorSearchHit[]> {
    return this.svc.searchTable(name, data?.query ?? '', data?.topK, data?.minScore)
  }
}
