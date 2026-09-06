import type { ToolCatalogEntry, ToolCatalogGroup } from './types'
import { TOOL_CATALOG_GROUPS, catalogGroupById } from './catalog/groups'
import { CORE_TOOLS } from './catalog/tools-core'
import { FILESYSTEM_TOOLS } from './catalog/tools-filesystem'
import { OPENFILE_TOOLS } from './catalog/tools-openfile'
import { MODSEARCH_TOOLS } from './catalog/tools-modsearch'
import { VMSANDBOX_TOOLS } from './catalog/tools-vmsandbox'
import { PYODIDE_TOOLS } from './catalog/tools-pyodide'
import { PLAYWRIGHT_TOOLS } from './catalog/tools-playwright'

/** 扁平工具目录：非 MCP 工具 + 各 MCP server 的子工具（id = 运行时工具名） */
export const TOOL_CATALOG: readonly ToolCatalogEntry[] = [
  ...CORE_TOOLS,
  ...FILESYSTEM_TOOLS,
  ...OPENFILE_TOOLS,
  ...MODSEARCH_TOOLS,
  ...VMSANDBOX_TOOLS,
  ...PYODIDE_TOOLS,
  ...PLAYWRIGHT_TOOLS,
]

export { TOOL_CATALOG_GROUPS, catalogGroupById }
export type { ToolCatalogGroup }

export function catalogById(id: string): ToolCatalogEntry | undefined {
  return TOOL_CATALOG.find((e) => e.id === id)
}

export function catalogByCategory(category: ToolCatalogEntry['category']): ToolCatalogEntry[] {
  return TOOL_CATALOG.filter((e) => e.category === category)
}

/** 分组下的全部子工具（含按需挂载的 defaultEnabled:false 工具） */
export function catalogByGroup(groupId: string): ToolCatalogEntry[] {
  return TOOL_CATALOG.filter((e) => e.groupId === groupId)
}
