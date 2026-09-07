import type { StructuredToolInterface } from '@langchain/core/tools'
import { wrapToolOutput } from './wrap'
import { TOOL_CATALOG } from './catalog'
import { createComputeTools } from './categories/compute'
import { createDatabaseTools } from './categories/database'
import { createKnowledgeTools } from './categories/knowledge'
import { createNewsFinanceTools } from './categories/news-finance'
import { createSearchTools } from './categories/search'
import { createWebTools } from './categories/web'
import { loadMcpTools, withDefaultMcpFilesystem, withDefaultMcpModsearch, withDefaultMcpOpenfile, withDefaultMcpPlaywright, withDefaultMcpPyodide, withDefaultMcpShellsandbox, withDefaultMcpVmsandbox } from './mcp'
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
    const explicitlyAllowed =
      !!allow && (allow.has(e.id) || (e.groupId !== undefined && allow.has(e.groupId)))
    if (allow && !explicitlyAllowed) return false
    // 仅在未被白名单显式选中时，才受 defaultEnabled / secret 约束
    if (!explicitlyAllowed) {
      if (!e.defaultEnabled && !e.requiresSecret) return false
      if (e.requiresSecret && !hasSecret(e, options.secrets)) return false
    }
    if (e.requiresWorkspace && !options.workspaceRoot) return false
    return true
  })

  const ids = new Set(selected.map((e) => e.id))
  const common = {
    ids,
    secrets: options.secrets,
    timeoutMs: options.timeoutMs ?? 30_000,
    maxOutputChars: options.maxOutputChars ?? 8_000,
  }

  // 本地文件只走 MCP filesystem / openfile（无 builtin 读/列/grep）
  const wantFs =
    options.mcpFilesystem !== false && selected.some((e) => e.groupId === 'mcp_filesystem')
  const wantOpen =
    options.mcpOpenfile !== false && selected.some((e) => e.groupId === 'mcp_openfile')
  const wantModsearch =
    options.mcpModsearch !== false && selected.some((e) => e.groupId === 'mcp_modsearch')
  const wantVmsandbox =
    options.mcpVmsandbox !== false && selected.some((e) => e.groupId === 'mcp_vmsandbox')
  const wantShellsandbox =
    options.mcpShellsandbox !== false && selected.some((e) => e.groupId === 'mcp_shellsandbox')
  const wantPyodide =
    options.mcpPyodide !== false && selected.some((e) => e.groupId === 'mcp_pyodide')
  const wantPlaywright =
    options.mcpPlaywright !== false && selected.some((e) => e.groupId === 'mcp_playwright')

  let mcpServers = withDefaultMcpFilesystem(
    wantFs ? options.workspaceRoot : undefined,
    options.mcpServers,
    wantFs,
  )
  mcpServers = withDefaultMcpOpenfile(
    wantOpen ? options.workspaceRoot : undefined,
    mcpServers,
    wantOpen,
  )
  mcpServers = withDefaultMcpModsearch(mcpServers, wantModsearch)
  mcpServers = withDefaultMcpVmsandbox(
    wantVmsandbox ? options.workspaceRoot : undefined,
    mcpServers,
    wantVmsandbox,
  )
  mcpServers = withDefaultMcpShellsandbox(
    wantShellsandbox ? options.workspaceRoot : undefined,
    mcpServers,
    wantShellsandbox,
  )
  mcpServers = withDefaultMcpPyodide(
    wantPyodide ? options.workspaceRoot : undefined,
    mcpServers,
    wantPyodide,
  )
  mcpServers = withDefaultMcpPlaywright(mcpServers, wantPlaywright)

  // MCP 协议只能整 server 拉工具；按目录条目过滤，只挂白名单 / 默认集中的子工具，
  // 解决「只读文件却加载整套 filesystem」的膨胀问题。未声明的子工具天然不挂。
  const wanted = new Set(selected.map((e) => e.id))
  const rawMcpTools = mcpServers
    ? await loadMcpTools({
        servers: mcpServers,
        onConnectionError: 'ignore',
        prefixToolNameWithServerName: true,
      })
    : []
  const mcpTools = rawMcpTools
    .filter((t) => wanted.has(t.name))
    .map((t) => wrapToolOutput(t, common.maxOutputChars))

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
