import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StructuredToolInterface } from '@langchain/core/tools'

/**
 * MCP 连接配置（对齐 `@langchain/mcp-adapters` MultiServerMCPClient）。
 * 外部能力优先走 MCP，而不是再包一层 community / 自研 CLI。
 */
export type McpServerConnection =
  | {
      transport?: 'stdio'
      command: string
      args?: string[]
      env?: Record<string, string>
      cwd?: string
      restart?: { enabled?: boolean; maxAttempts?: number; delayMs?: number }
    }
  | {
      transport: 'sse' | 'http'
      url: string
      headers?: Record<string, string>
      reconnect?: { enabled?: boolean; maxAttempts?: number; delayMs?: number }
    }
  | {
      /** 省略 transport 且带 url → 默认 streamable HTTP */
      url: string
      headers?: Record<string, string>
    }

export interface LoadMcpToolsOptions {
  /** server 名 → 连接 */
  servers: Record<string, McpServerConnection>
  /** 连接失败时忽略该 server（默认）；调试可改 throw */
  onConnectionError?: 'throw' | 'ignore'
  /** 工具名是否加 `{server}__` 前缀，多 server 时建议 true */
  prefixToolNameWithServerName?: boolean
}

/** 默认 MCP filesystem server 名（工具前缀 `filesystem__*`） */
export const MCP_FILESYSTEM_SERVER_NAME = 'filesystem'

/** 默认 MCP openfile server 名（工具前缀 `openfile__*`） */
export const MCP_OPENFILE_SERVER_NAME = 'openfile'

/** 默认 MCP modsearch server 名（工具前缀 `modsearch__*`） */
export const MCP_MODSEARCH_SERVER_NAME = 'modsearch'

const requireFromHere = createRequire(
  typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url),
)

function electronRunAsNodeEnv(): Record<string, string> {
  const env: Record<string, string> = { ...process.env } as Record<string, string>
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1'
  }
  return env
}

/**
 * 解析 `@modelcontextprotocol/server-filesystem` 入口（包内 dist，不依赖 PATH/`npx`）。
 */
export function resolveMcpFilesystemServerEntry(): string {
  const pkgJson = requireFromHere.resolve('@modelcontextprotocol/server-filesystem/package.json')
  return join(dirname(pkgJson), 'dist', 'index.js')
}

/**
 * 解析 `@chatvein/mcp-openfile-sdk` CLI 入口（包内 dist/cli.js）。
 */
export function resolveMcpOpenfileServerEntry(): string {
  const main = requireFromHere.resolve('@chatvein/mcp-openfile-sdk')
  return join(dirname(main), 'cli.js')
}

/**
 * 解析 `@chatvein/mcp-modsearch-sdk` CLI 入口（包内 dist/cli.js）。
 */
export function resolveMcpModsearchServerEntry(): string {
  const main = requireFromHere.resolve('@chatvein/mcp-modsearch-sdk')
  return join(dirname(main), 'cli.js')
}

/**
 * 把工作区根挂成 MCP filesystem server（CLI args = 唯一允许目录 → 对齐沙箱 jail）。
 * Electron 下用 `process.execPath` + `ELECTRON_RUN_AS_NODE`。
 */
export function createMcpFilesystemServer(workspaceRoot: string): McpServerConnection {
  const root = workspaceRoot.trim()
  if (!root) {
    throw new Error('createMcpFilesystemServer: workspaceRoot 不能为空')
  }
  return {
    transport: 'stdio',
    command: process.execPath,
    args: [resolveMcpFilesystemServerEntry(), root],
    env: electronRunAsNodeEnv(),
  }
}

/**
 * 把工作区根挂成 MCP openfile server（在资源管理器中打开文件夹；文件则打开父目录）。
 */
export function createMcpOpenfileServer(workspaceRoot: string): McpServerConnection {
  const root = workspaceRoot.trim()
  if (!root) {
    throw new Error('createMcpOpenfileServer: workspaceRoot 不能为空')
  }
  return {
    transport: 'stdio',
    command: process.execPath,
    args: [resolveMcpOpenfileServerEntry(), root],
    env: electronRunAsNodeEnv(),
  }
}

/**
 * 挂 MCP modsearch（联网搜索 / 读页；搜索失败兜底 DuckDuckGo）。
 */
export function createMcpModsearchServer(options?: {
  timeoutMs?: number
  fallback?: boolean
}): McpServerConnection {
  const args = [resolveMcpModsearchServerEntry()]
  if (options?.timeoutMs && options.timeoutMs > 0) {
    args.push(`--timeout=${options.timeoutMs}`)
  }
  if (options?.fallback === false) {
    args.push('--no-fallback')
  }
  return {
    transport: 'stdio',
    command: process.execPath,
    args,
    env: electronRunAsNodeEnv(),
  }
}

/**
 * 合并多份 mcpServers；后者覆盖同名 server。
 * `undefined` / 空对象跳过。
 */
export function mergeMcpServers(
  ...parts: Array<Record<string, McpServerConnection> | undefined>
): Record<string, McpServerConnection> | undefined {
  const out: Record<string, McpServerConnection> = {}
  for (const part of parts) {
    if (!part) continue
    Object.assign(out, part)
  }
  return Object.keys(out).length > 0 ? out : undefined
}

/**
 * 有 workspaceRoot 时默认注入 `filesystem`（可用已有同名配置覆盖）。
 * `enabled === false` 时不注入。
 */
export function withDefaultMcpFilesystem(
  workspaceRoot: string | undefined,
  servers: Record<string, McpServerConnection> | undefined,
  enabled = true,
): Record<string, McpServerConnection> | undefined {
  if (!enabled || !workspaceRoot?.trim()) return servers
  if (servers?.[MCP_FILESYSTEM_SERVER_NAME]) return servers
  return mergeMcpServers(
    { [MCP_FILESYSTEM_SERVER_NAME]: createMcpFilesystemServer(workspaceRoot) },
    servers,
  )
}

/**
 * 有 workspaceRoot 时默认注入 `openfile`（可用已有同名配置覆盖）。
 * `enabled === false` 时不注入。
 */
export function withDefaultMcpOpenfile(
  workspaceRoot: string | undefined,
  servers: Record<string, McpServerConnection> | undefined,
  enabled = true,
): Record<string, McpServerConnection> | undefined {
  if (!enabled || !workspaceRoot?.trim()) return servers
  if (servers?.[MCP_OPENFILE_SERVER_NAME]) return servers
  return mergeMcpServers(
    { [MCP_OPENFILE_SERVER_NAME]: createMcpOpenfileServer(workspaceRoot) },
    servers,
  )
}

/**
 * 默认注入 `modsearch`（不依赖 workspace；可用同名配置覆盖）。
 */
export function withDefaultMcpModsearch(
  servers: Record<string, McpServerConnection> | undefined,
  enabled = true,
): Record<string, McpServerConnection> | undefined {
  if (!enabled) return servers
  if (servers?.[MCP_MODSEARCH_SERVER_NAME]) return servers
  return mergeMcpServers(
    { [MCP_MODSEARCH_SERVER_NAME]: createMcpModsearchServer() },
    servers,
  )
}

/**
 * 从已配置的 MCP servers 拉工具列表，转成 LangChain StructuredTool。
 * 无 servers 时返回 []；单 server 失败默认忽略，不拖垮整轮 Chat。
 */
export async function loadMcpTools(
  options: LoadMcpToolsOptions,
): Promise<StructuredToolInterface[]> {
  const names = Object.keys(options.servers ?? {})
  if (names.length === 0) return []

  try {
    const { MultiServerMCPClient } = await import('@langchain/mcp-adapters')
    type ClientConfig = import('@langchain/mcp-adapters').ClientConfig
    const mcpServers = normalizeMcpServers(options.servers) as ClientConfig['mcpServers']
    const client = new MultiServerMCPClient({
      throwOnLoadError: false,
      onConnectionError: options.onConnectionError ?? 'ignore',
      prefixToolNameWithServerName: options.prefixToolNameWithServerName ?? true,
      mcpServers,
    })
    const tools = await client.getTools()
    return tools as StructuredToolInterface[]
  } catch (err) {
    console.warn('[chatvein/tools] loadMcpTools failed:', err)
    return []
  }
}

/** 补齐 stdio `args` 等必填字段，满足 mcp-adapters Connection 形状 */
function normalizeMcpServers(
  servers: Record<string, McpServerConnection>,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  for (const [name, conn] of Object.entries(servers)) {
    if (conn && typeof conn === 'object' && 'command' in conn) {
      out[name] = {
        ...conn,
        args: Array.isArray(conn.args) ? conn.args : [],
      }
    } else {
      out[name] = { ...conn }
    }
  }
  return out
}

/**
 * 解析 `CHATVEIN_MCP_SERVERS` JSON（与 MultiServerMCPClient 的 mcpServers 同形）。
 * 例：`{"brave":{"command":"npx","args":["-y","@modelcontextprotocol/server-brave-search"]}}`
 */
export function parseMcpServersJson(
  raw: string | undefined,
): Record<string, McpServerConnection> | undefined {
  if (!raw?.trim()) return undefined
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      console.warn('[chatvein/tools] CHATVEIN_MCP_SERVERS must be a JSON object')
      return undefined
    }
    return parsed as Record<string, McpServerConnection>
  } catch (err) {
    console.warn('[chatvein/tools] CHATVEIN_MCP_SERVERS invalid JSON:', err)
    return undefined
  }
}

/** 是否已拉到 filesystem MCP 工具 */
export function hasMcpFilesystemTools(tools: StructuredToolInterface[]): boolean {
  const prefix = `${MCP_FILESYSTEM_SERVER_NAME}__`
  return tools.some((t) => t.name.startsWith(prefix))
}

/** 是否已拉到 openfile MCP 工具 */
export function hasMcpOpenfileTools(tools: StructuredToolInterface[]): boolean {
  const prefix = `${MCP_OPENFILE_SERVER_NAME}__`
  return tools.some((t) => t.name.startsWith(prefix))
}

/** 是否已拉到 modsearch MCP 工具 */
export function hasMcpModsearchTools(tools: StructuredToolInterface[]): boolean {
  const prefix = `${MCP_MODSEARCH_SERVER_NAME}__`
  return tools.some((t) => t.name.startsWith(prefix))
}
