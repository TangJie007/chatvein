/**
 * 工具装配（实现方案 §7 / §15）。
 *
 * runtime 注入的候选池由工厂闭包传入；母图在调用 worker 前
 * 按「当前 domain + toolsPolicy」再切一刀。具体工具子集由做任务的节点再选。
 */
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ConversationRoute, Domain, ToolsPolicy } from './types'

export type ToolsByDomain = Partial<Record<Domain, StructuredToolInterface[]>>

/**
 * 每轮工具再筛选（弱模挑选本轮真正用得上的工具）。
 *
 * 返回 `undefined` / 空表示「不筛，用 `pool`」；返回的集合会被 `pool` 交集约束，
 * 保证筛选器无法凭空造出不在候选池里的工具。
 */
export type ToolsResolver = (ctx: {
  /** 本轮用户文本（已剥离指令前缀后的正文） */
  text: string
  /** 本轮路由快照（可能尚未就绪） */
  route?: ConversationRoute
  domain: Domain
  toolsPolicy: ToolsPolicy
  /** 按 domain + toolsPolicy 切过之后的候选池 */
  pool: StructuredToolInterface[]
}) =>
  | StructuredToolInterface[]
  | undefined
  | void
  | Promise<StructuredToolInterface[] | undefined | void>

export interface ResolveToolsOptions {
  /** runtime 预筛后的候选全集 */
  tools?: StructuredToolInterface[]
  /** 按领域预切好的工具表（优先于对 tools 的二次过滤） */
  toolsByDomain?: ToolsByDomain
  /** 每轮再筛选（内置工具筛选器挂在这里） */
  resolver?: ToolsResolver
  /** 本轮用户文本，传给 resolver */
  text?: string
  /** 本轮路由快照，传给 resolver */
  route?: ConversationRoute
  domain?: Domain
  toolsPolicy: ToolsPolicy
}

/** 只读判定：工具未标注 `metadata.readOnly` 时视为可用（预筛职责在 runtime） */
function isAllowedUnderReadOnly(tool: StructuredToolInterface): boolean {
  const meta = (tool as { metadata?: Record<string, unknown> }).metadata
  if (!meta) return true
  const flag = meta.readOnly ?? meta.readonly
  return flag === undefined ? true : Boolean(flag)
}

/**
 * 解析本步可用工具：
 * - `none` → 空表（direct·reply_only / 桌面默认）
 * - `full` → `toolsByDomain[domain] ?? tools`
 * - `readonly` → 在上一步结果上去掉显式标注 `readOnly === false` 的工具
 * - 最后交给可选 `resolver` 按本轮文本再筛一刀
 */
export async function resolveTools(
  options: ResolveToolsOptions,
): Promise<StructuredToolInterface[]> {
  if (options.toolsPolicy === 'none') return []
  const domain = options.domain ?? 'general'
  const source = options.toolsByDomain?.[domain] ?? options.tools ?? []
  const pool =
    options.toolsPolicy === 'full' ? [...source] : source.filter(isAllowedUnderReadOnly)
  if (!options.resolver) return pool

  let picked: StructuredToolInterface[] | undefined | void
  try {
    picked = await options.resolver({
      text: options.text ?? '',
      ...(options.route ? { route: options.route } : {}),
      domain,
      toolsPolicy: options.toolsPolicy,
      pool,
    })
  } catch {
    // 筛选器永不阻断路：失败则用未筛的候选池（宁多给勿漏）
    return pool
  }
  if (!picked?.length) return pool

  const allowed = new Set(pool.map((t) => t.name))
  const filtered = picked.filter((t) => allowed.has(t.name))
  return filtered.length ? filtered : pool
}
