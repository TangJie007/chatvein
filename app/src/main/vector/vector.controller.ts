import { Controller, IpcHandle, Inject } from '@electrum/common'
import { VectorService } from './vector.service'
import type {
  VectorBrowseResult,
  VectorHybridSearchHit,
  VectorRebuildResult,
  VectorTableInfo,
} from './vector.service'

@Controller('vector')
export class VectorController {
  @Inject(VectorService)
  private svc!: VectorService

  /** 列出向量数据集内的全部表及其结构（供「向量库」浏览器） */
  @IpcHandle('inspectTables')
  inspectTables(): Promise<VectorTableInfo[]> {
    return this.svc.inspectTables()
  }

  /** 完全重建某张向量表（当前仅 tool_index 受管；重算全部工具向量并清理陈旧行） */
  @IpcHandle('rebuildTable')
  rebuildTable(name: string): Promise<VectorRebuildResult> {
    return this.svc.rebuildTable(name)
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

  /** 向量 + BM25 加权检索 tool_index：工具名/别名 BM25 与向量余弦 RRF 融合（对话工具预筛 C1 同款） */
  @IpcHandle('hybridSearchTable')
  hybridSearchTable(
    name: string,
    data: { query: string; topK?: number; minScore?: number },
  ): Promise<VectorHybridSearchHit[]> {
    return this.svc.hybridSearchTable(name, data?.query ?? '', data?.topK, data?.minScore)
  }
}
