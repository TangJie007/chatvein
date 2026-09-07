import type { ToolCatalogEntry } from '../types'
import { titleFromDescription } from './build'
import { TOOL_CATALOG_GROUPS } from './groups'

/** 与 deepagents FsToolName 对齐（不含 execute） */
export const STATE_FILESYSTEM_TOOL_NAMES = [
  'ls',
  'read_file',
  'write_file',
  'edit_file',
  'glob',
  'grep',
] as const

export type StateFilesystemToolName = (typeof STATE_FILESYSTEM_TOOL_NAMES)[number]

export const STATE_FILESYSTEM_GROUP_ID = 'state_filesystem'

const GROUP = TOOL_CATALOG_GROUPS.find((g) => g.id === STATE_FILESYSTEM_GROUP_ID)!

/** 目录条目：id = 运行时工具名（middleware 无 server 前缀） */
export const STATE_FILESYSTEM_TOOLS: readonly ToolCatalogEntry[] = [
  {
    tool: 'ls',
    description:
      '列出虚路径目录下的文件与子目录（非递归）。浏览工作区结构、看有哪些文件。ls list directory folder contents.',
  },
  {
    tool: 'read_file',
    description:
      '读取单个文本文件内容；可按行 offset/limit。查看源码、配置、日志。read file cat view source contents.',
  },
  {
    tool: 'write_file',
    description:
      '新建或整文件覆盖写入文本。创建/保存/覆盖文件。write create overwrite save file.',
  },
  {
    tool: 'edit_file',
    description:
      '对已有文件做精确 search-replace（可 replace_all）。改代码、补丁、局部编辑。edit patch replace lines.',
  },
  {
    tool: 'glob',
    description:
      '按 glob 模式匹配文件路径。找文件名、按扩展名列举。glob find files by pattern.',
  },
  {
    tool: 'grep',
    description:
      '在文件内容中搜索字面文本（可限路径）。搜符号、字符串、引用。grep search text in files.',
  },
].map((t) => ({
  id: t.tool,
  category: GROUP.category,
  title: titleFromDescription(t.description),
  description: t.description,
  source: GROUP.source,
  groupId: GROUP.id,
  requiresWorkspace: GROUP.requiresWorkspace,
  keywords: GROUP.keywords,
  defaultEnabled: true,
}))

const FS_NAME_SET = new Set<string>(STATE_FILESYSTEM_TOOL_NAMES)

export function isStateFilesystemToolId(id: string): boolean {
  return FS_NAME_SET.has(id)
}

/** deepagents `customToolDescriptions`：目录 description → 工具名 */
export function stateFilesystemCustomDescriptions(): Partial<
  Record<StateFilesystemToolName, string>
> {
  const out: Partial<Record<StateFilesystemToolName, string>> = {}
  for (const e of STATE_FILESYSTEM_TOOLS) {
    out[e.id as StateFilesystemToolName] = e.description
  }
  return out
}

/**
 * 将 C1/C2 选中名收成 middleware allowlist。
 * - 空 → null（不挂 filesystem middleware）
 * - 非空时强制带上 `read_file`（deepagents 硬要求）
 */
export function normalizeStateFilesystemAllowlist(
  selectedIds: readonly string[],
): StateFilesystemToolName[] | null {
  const picked = STATE_FILESYSTEM_TOOL_NAMES.filter((n) => selectedIds.includes(n))
  if (picked.length === 0) return null
  if (!picked.includes('read_file')) {
    return ['read_file', ...picked]
  }
  return [...picked]
}

/**
 * 按 policy / 白名单筛出本轮可参与 C1/C2 的 StateBackend FS 目录条目。
 * 无 workspace 时返回空（与 requiresWorkspace 对齐）。
 */
export function selectStateFilesystemCatalogEntries(options: {
  policy: import('../types').ToolPolicy
  allowIds?: string[] | 'all'
  workspaceRoot?: string
}): ToolCatalogEntry[] {
  if (options.policy === 'none' || options.policy === 'unknown') return []
  if (!options.workspaceRoot?.trim()) return []
  const allow =
    options.allowIds === undefined || options.allowIds === 'all'
      ? null
      : new Set(options.allowIds)
  return STATE_FILESYSTEM_TOOLS.filter((e) => {
    if (!allow) return e.defaultEnabled
    return allow.has(e.id) || (e.groupId !== undefined && allow.has(e.groupId))
  })
}

/** 索引 / 预筛用的嵌入输入（与 StructuredTool 并列） */
export function stateFilesystemIndexInputs(): Array<{ name: string; description: string }> {
  return STATE_FILESYSTEM_TOOLS.map((e) => ({ name: e.id, description: e.description }))
}
