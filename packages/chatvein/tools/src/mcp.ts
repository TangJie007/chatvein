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
export function parseMcpServersJson(raw: string | undefined): Record<string, McpServerConnection> | undefined {
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
