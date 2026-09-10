/**
 * 路由原型语料种子：供宿主傻瓜式建向量表。
 *
 * 本文件**不**依赖 embedding / LanceDB；只导出文档列表、表名与语料版本。
 */
import { createHash } from 'node:crypto'
import type { Domain, Lane } from '../../types'
import { DEFAULT_PROTOTYPES, type Prototype } from './prototypes'

/** LanceDB 表名约定（宿主建表必须用这个名字） */
export const ROUTE_PROTOTYPE_TABLE = 'router-prototypes'

export interface RoutePrototypeDocMeta {
  lane: Lane
  domain: Domain
  /** 来源分组，如 agentic|code */
  set: string
}

/** 扁平建表文档 */
export interface RoutePrototypeDoc {
  id: string
  text: string
  metadata: RoutePrototypeDocMeta
}

/** 宿主一次拿走的完整种子 */
export interface RoutePrototypeSeed {
  table: string
  version: string
  docs: RoutePrototypeDoc[]
}

/**
 * 将分组原型展平为建表文档。
 * id 稳定：`${lane}|${domain}|${index}`（同版本内可复现）。
 */
export function listRoutePrototypeDocs(
  list: Prototype[] = DEFAULT_PROTOTYPES,
): RoutePrototypeDoc[] {
  const docs: RoutePrototypeDoc[] = []
  for (const p of list) {
    const set = `${p.lane}|${p.domain}`
    p.texts.forEach((text, i) => {
      const trimmed = text.trim()
      if (!trimmed) return
      docs.push({
        id: `${set}|${String(i).padStart(3, '0')}`,
        text: trimmed,
        metadata: { lane: p.lane, domain: p.domain, set },
      })
    })
  }
  return docs
}

/**
 * 语料内容指纹。宿主用它决定是否 `overwrite` 重建；
 * 与包版本无关——只随原型文本/标签变化。
 */
export function getRoutePrototypeCorpusVersion(
  list: Prototype[] = DEFAULT_PROTOTYPES,
): string {
  const docs = listRoutePrototypeDocs(list)
  const payload = docs.map((d) => `${d.id}\t${d.metadata.lane}\t${d.metadata.domain}\t${d.text}`).join('\n')
  return createHash('sha256').update(payload).digest('hex').slice(0, 16)
}

/** 傻瓜建表一次性种子包 */
export function getRoutePrototypeSeed(
  list: Prototype[] = DEFAULT_PROTOTYPES,
): RoutePrototypeSeed {
  return {
    table: ROUTE_PROTOTYPE_TABLE,
    version: getRoutePrototypeCorpusVersion(list),
    docs: listRoutePrototypeDocs(list),
  }
}
