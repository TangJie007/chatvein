import type { StructuredToolInterface } from '@langchain/core/tools'
import { TOOL_CATALOG } from './catalog'
import { createComputeTools } from './categories/compute'
import { createDatabaseTools } from './categories/database'
import { createKnowledgeTools } from './categories/knowledge'
import { createLocalFsTools } from './categories/local-fs'
import { createNewsFinanceTools } from './categories/news-finance'
import { createSearchTools } from './categories/search'
import { createWebTools } from './categories/web'
import type { ResolveChatToolsOptions, ToolCatalogEntry, ToolSecrets } from './types'

function hasSecret(entry: ToolCatalogEntry, secrets?: ToolSecrets): boolean {
  if (!entry.requiresSecret) return true
  switch (entry.requiresSecret) {
    case 'serp':
      return Boolean(secrets?.serpApiKey)
    case 'brave':
      return Boolean(secrets?.braveApiKey)
    case 'tavily':
      return Boolean(secrets?.tavilyApiKey)
    case 'wolfram':
      return Boolean(secrets?.wolframAppId)
    default:
      return false
  }
}

function needsWorkspace(id: string): boolean {
  return (
    id === 'read_file' ||
    id === 'list_dir' ||
    id === 'grep_search' ||
    id === 'sqlite_query'
  )
}

/** 根据 policy / 白名单 / 密钥解析可绑定工具列表 */
export async function resolveChatTools(
  options: ResolveChatToolsOptions,
): Promise<StructuredToolInterface[]> {
  if (options.policy === 'none' || options.policy === 'unknown') {
    return []
  }

  const allow =
    options.allowIds === undefined || options.allowIds === 'all'
      ? null
      : new Set(options.allowIds)

  const selected = TOOL_CATALOG.filter((e) => {
    if (allow && !allow.has(e.id)) return false
    if (!e.defaultEnabled && !hasSecret(e, options.secrets)) return false
    if (e.requiresSecret && !hasSecret(e, options.secrets)) return false
    if (needsWorkspace(e.id) && !options.workspaceRoot) return false
    return true
  })

  const ids = new Set(selected.map((e) => e.id))
  if (ids.size === 0) return []

  const common = {
    ids,
    secrets: options.secrets,
    timeoutMs: options.timeoutMs,
    maxOutputChars: options.maxOutputChars,
  }

  const parts = await Promise.all([
    createSearchTools(common),
    createComputeTools(common),
    createNewsFinanceTools(common),
    createKnowledgeTools(common),
  ])

  const syncParts: StructuredToolInterface[] = [
    ...createWebTools(common),
    ...(options.workspaceRoot
      ? [
          ...createLocalFsTools({ ...common, workspaceRoot: options.workspaceRoot }),
          ...createDatabaseTools({ ...common, workspaceRoot: options.workspaceRoot }),
        ]
      : []),
  ]

  return [...parts.flat(), ...syncParts]
}

/** 默认可跑工具 id（无密钥、可无 workspace 的子集说明见 catalog） */
export function defaultChatToolIds(): string[] {
  return TOOL_CATALOG.filter((e) => e.defaultEnabled && !e.requiresSecret).map((e) => e.id)
}
