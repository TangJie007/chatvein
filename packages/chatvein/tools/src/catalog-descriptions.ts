import type { StructuredToolInterface } from '@langchain/core/tools'
import { TOOL_CATALOG } from './catalog'

/**
 * 按工具名解析目录描述（收敛自原 `MCP_*_DESCRIPTION_OVERRIDES`）。
 * 先按 id 精确匹配（运行时工具名与目录 id 一致），
 * 再按 `server + tool` 兜底（兼容未开前缀的 MCP 连接）。
 */
export function resolveCatalogDescription(toolName: string): string | undefined {
  const direct = TOOL_CATALOG.find((e) => e.id === toolName)
  if (direct) return direct.description
  const i = toolName.indexOf('__')
  if (i > 0) {
    const server = toolName.slice(0, i)
    const bare = toolName.slice(i + 2)
    const entry = TOOL_CATALOG.find((e) => e.mcp?.server === server && e.mcp?.tool === bare)
    if (entry) return entry.description
  }
  // 裸名兜底：仅当全目录中唯一匹配时返回（跨 server 同名需带前缀消歧，如 list_allowed_directories）
  const byTool = TOOL_CATALOG.filter((e) => e.mcp?.tool === toolName)
  if (byTool.length === 1) return byTool[0].description
  return undefined
}

/** 就地改写工具的 description（优先 defineProperty，失败兜底赋值） */
export function setToolDescription(tool: StructuredToolInterface, description: string): void {
  try {
    Object.defineProperty(tool, 'description', {
      value: description,
      writable: true,
      configurable: true,
      enumerable: true,
    })
  } catch {
    ;(tool as { description: string }).description = description
  }
}

/** 在 loadMcpTools 后覆盖官方长描述为目录短描述（利于向量区分度、压缩模型 token） */
export function applyCatalogDescriptions(
  tools: StructuredToolInterface[],
): StructuredToolInterface[] {
  for (const tool of tools) {
    const next = resolveCatalogDescription(tool.name)
    if (next) setToolDescription(tool, next)
  }
  return tools
}
