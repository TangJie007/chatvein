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
  id: string
  category: ToolCategory
  title: string
  description: string
  /** community | builtin | dedicated:<pkg> */
  source: string
  /** 无密钥时是否进入 Chat 默认集 */
  defaultEnabled: boolean
  requiresSecret?: ToolSecretKind
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
}

export type { StructuredToolInterface, ToolPolicy }
