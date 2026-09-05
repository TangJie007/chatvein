import type { StructuredToolInterface } from '@langchain/core/tools'
import { TOOL_CATALOG } from './catalog'
import { createComputeTools } from './categories/compute'
import { createDatabaseTools } from './categories/database'
import { createKnowledgeTools } from './categories/knowledge'
import { createNewsFinanceTools } from './categories/news-finance'
import { createSearchTools } from './categories/search'
import { createWebTools } from './categories/web'
import { loadMcpTools, withDefaultMcpFilesystem } from './mcp'
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
  return id === 'sqlite_query' || id === 'mcp_filesystem'
}

/** 根据 policy / 白名单 / 密钥 / MCP 解析可绑定工具列表 */
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
  const common = {
    ids,
    secrets: options.secrets,
    timeoutMs: options.timeoutMs,
    maxOutputChars: options.maxOutputChars,
  }

  // 本地文件只走 MCP filesystem（无 builtin 读/列/grep）
  const wantFs =
    options.mcpFilesystem !== false && selected.some((e) => e.id === 'mcp_filesystem')

  const mcpServers = withDefaultMcpFilesystem(
    wantFs ? options.workspaceRoot : undefined,
    options.mcpServers,
    wantFs,
  )

  const mcpTools = mcpServers
    ? await loadMcpTools({
        servers: mcpServers,
        onConnectionError: 'ignore',
        prefixToolNameWithServerName: true,
      })
    : []

  const catalogParts =
    ids.size === 0
      ? ([] as StructuredToolInterface[])
      : (
          await Promise.all([
            createSearchTools(common),
            createComputeTools(common),
            createNewsFinanceTools(common),
            createKnowledgeTools(common),
          ])
        ).flat()

  const syncParts: StructuredToolInterface[] =
    ids.size === 0
      ? []
      : [
          ...createWebTools(common),
          ...(options.workspaceRoot
            ? createDatabaseTools({ ...common, workspaceRoot: options.workspaceRoot })
            : []),
        ]

  const catalogTools = [...catalogParts, ...syncParts]

  const byName = new Map<string, StructuredToolInterface>()
  for (const t of catalogTools) byName.set(t.name, t)
  for (const t of mcpTools) byName.set(t.name, t)
  return [...byName.values()]
}

/** 默认可跑工具 id（无密钥、可无 workspace 的子集说明见 catalog） */
export function defaultChatToolIds(): string[] {
  return TOOL_CATALOG.filter((e) => e.defaultEnabled && !e.requiresSecret).map((e) => e.id)
}
