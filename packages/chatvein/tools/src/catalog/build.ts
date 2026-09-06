import type { ToolCatalogEntry, ToolCatalogGroup } from '../types'

/** MCP 子工具定义（描述来自原 `MCP_*_DESCRIPTION_OVERRIDES`，已收敛于此） */
export interface McpToolDef {
  tool: string
  description: string
  /** 省略则按首句自动派生（见 titleFromDescription） */
  title?: string
  /** 省略则继承分组 keywords */
  keywords?: string[]
  /** 省略则 true（进入默认集） */
  defaultEnabled?: boolean
  deprecated?: boolean
}

/**
 * 由分组元数据批量生成 MCP 子工具目录条目。
 * id = `${group.mcpServer}__${tool}`，与运行时 `loadMcpTools`（prefix: true）返回的工具名一致，
 * 因此白名单 / 向量索引 / 绑定过滤三者对齐到同一把钥匙。
 */
export function defineMcpTools(
  group: ToolCatalogGroup,
  tools: readonly McpToolDef[],
): ToolCatalogEntry[] {
  const server = group.mcpServer
  if (!server) {
    throw new Error(`defineMcpTools: group ${group.id} 缺少 mcpServer`)
  }
  return tools.map((t) => ({
    id: `${server}__${t.tool}`,
    category: group.category,
    title: t.title ?? titleFromDescription(t.description),
    description: t.description,
    source: group.source,
    groupId: group.id,
    mcp: { server, tool: t.tool },
    requiresWorkspace: group.requiresWorkspace,
    keywords: t.keywords ?? group.keywords,
    defaultEnabled: t.defaultEnabled ?? true,
    deprecated: t.deprecated,
  }))
}

/** 从描述首句派生短标题（中文句号 / 英文标点截断，限 40 字） */
export function titleFromDescription(desc: string): string {
  const cut = desc.search(/[。.!?！？]/)
  const head = cut >= 0 ? desc.slice(0, cut) : desc
  return head.length > 40 ? `${head.slice(0, 39)}…` : head
}
