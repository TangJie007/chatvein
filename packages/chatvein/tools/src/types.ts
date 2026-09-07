import type { StructuredToolInterface } from '@langchain/core/tools'
import type { ToolPolicy } from '@chatvein/common'

/** 工具品类（与设计文档 12 七大类对齐） */
export type ToolCategory =
  | 'search'
  | 'compute'
  | 'local_fs'
  | 'web'
  | 'news_finance'
  | 'database'
  | 'knowledge'

export type ToolSecretKind = 'serp' | 'brave' | 'tavily' | 'wolfram'

export interface ToolCatalogEntry {
  /** MCP 子工具 = 运行时工具名（filesystem__read_text_file）；非 MCP = 工具名（calculator） */
  id: string
  category: ToolCategory
  title: string
  /** 模型 prompt 与向量共用（中英混排短描述，< 280 字符） */
  description: string
  /** 'mcp:<pkg>' | 'builtin' | 'community:<pkg>' */
  source: string
  /** 无密钥时是否进入 Chat 默认集 */
  defaultEnabled: boolean
  requiresSecret?: ToolSecretKind
  /**
   * 检索关键词（中英混排）：同时服务关键词预筛与工具向量化。
   * MCP 子工具未显式给出时，回退到所属分组的 keywords。
   */
  keywords?: string[]
  /** 来源：哪个 MCP server 的哪个子工具（非 MCP 省略） */
  mcp?: { server: string; tool: string }
  /** 所属分组 id（server 级）：UI 折叠、整组白名单、workspace 依赖判定 */
  groupId?: string
  /** 需要 workspaceRoot 才可用（替代 resolve.ts 里硬编码的 needsWorkspace） */
  requiresWorkspace?: boolean
  /** 已弃用：不进向量索引、不进默认集 */
  deprecated?: boolean
}

/** server / 独立工具分组：承载连接信息与 UI 展示 */
export interface ToolCatalogGroup {
  id: string // 'mcp_filesystem'
  category: ToolCategory
  title: string
  description: string
  source: string // 'mcp:@modelcontextprotocol/server-filesystem'
  /** MCP server 名（未设置表示非 MCP 分组） */
  mcpServer?: string
  requiresWorkspace?: boolean
  defaultEnabled: boolean
  keywords?: string[]
}

export interface ToolSecrets {
  serpApiKey?: string
  braveApiKey?: string
  tavilyApiKey?: string
  wolframAppId?: string
}

export interface ResolveChatToolsOptions {
  policy: ToolPolicy
  /**
   * 角色白名单；`'all'` 或省略 = 目录中 defaultEnabled（及已提供密钥的可选工具）。
   * 与 `policy.tools=full` 求交。
   */
  allowIds?: string[] | 'all'
  /** 本地文件 / sqlite 路径根；缺省则跳过需 jail 的工具 */
  workspaceRoot?: string
  secrets?: ToolSecrets
  timeoutMs?: number
  maxOutputChars?: number
  /**
   * MCP servers（优先源）。配置后与目录工具合并；同名时 MCP 覆盖 catalog。
   * 通常由 `CHATVEIN_MCP_SERVERS` 或设置页注入。
   * 有 `workspaceRoot` 且未关闭对应开关时，会自动注入
   * filesystem / openfile（仅允许该根）；`mcp_modsearch` / `mcp_playwright` 选中时注入对应 server（不依赖 workspace）。
   */
  mcpServers?: Record<string, import('./mcp').McpServerConnection>
  /**
   * 是否在有 workspaceRoot 时自动挂 MCP filesystem（默认 true）。
   * 设为 false 则不注入 filesystem（本地文件能力为空，除非 mcpServers 自行配置）。
   */
  mcpFilesystem?: boolean
  /**
   * 是否在有 workspaceRoot 时自动挂 MCP openfile（默认 true）。
   */
  mcpOpenfile?: boolean
  /**
   * 是否自动挂 MCP modsearch（默认 true；不依赖 workspace）。
   */
  mcpModsearch?: boolean
  /**
   * 是否在有 workspaceRoot 时自动挂 MCP vmsandbox（默认 true）。
   */
  mcpVmsandbox?: boolean
  /**
   * 是否在有 workspaceRoot 时自动挂 MCP shellsandbox（默认 true）。
   */
  mcpShellsandbox?: boolean
  /**
   * 是否在有 workspaceRoot 时自动挂 MCP pyodide（默认 true）。
   */
  mcpPyodide?: boolean
  /**
   * 是否自动挂 MCP playwright（默认 true；不依赖 workspace）。
   */
  mcpPlaywright?: boolean
}

export type { StructuredToolInterface, ToolPolicy }
