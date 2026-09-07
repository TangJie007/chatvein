import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { StructuredToolInterface } from '@langchain/core/tools'
import { applyCatalogDescriptions } from './catalog-descriptions'

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

/** 默认 MCP vmsandbox server 名（工具前缀 `vmsandbox__*`） */
export const MCP_VMSANDBOX_SERVER_NAME = 'vmsandbox'

/** 默认 MCP shellsandbox server 名（工具前缀 `shellsandbox__*`） */
export const MCP_SHELLSANDBOX_SERVER_NAME = 'shellsandbox'

/** 默认 MCP pyodide server 名（工具前缀 `pyodide__*`） */
export const MCP_PYODIDE_SERVER_NAME = 'pyodide'

/** 默认 MCP playwright server 名（工具前缀 `playwright__*`） */
export const MCP_PLAYWRIGHT_SERVER_NAME = 'playwright'

const requireFromHere = createRequire(
  typeof __filename !== 'undefined' ? __filename : fileURLToPath(import.meta.url),
)

/**
 * 解析本仓 MCP SDK 的 dist/cli.js。
 * Electron 会把 `@chatvein/tools` 源码打进 `app/out/main`，此时 createRequire(__filename)
 * 只从 app → 仓库根 node_modules 查找；新建的 workspace 包可能尚未 hoist 到根。
 * 因此优先经 `@chatvein/tools/package.json` 的依赖树解析。
 */
function resolveChatveinMcpCli(pkgName: string): string {
  const tryResolve = (req: NodeRequire): string => join(dirname(req.resolve(pkgName)), 'cli.js')
  try {
    const toolsPkg = requireFromHere.resolve('@chatvein/tools/package.json')
    return tryResolve(createRequire(toolsPkg))
  } catch {
    return tryResolve(requireFromHere)
  }
}

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

/** 解析 `@chatvein/mcp-openfile-sdk` CLI 入口（包内 dist/cli.js）。 */
export function resolveMcpOpenfileServerEntry(): string {
  return resolveChatveinMcpCli('@chatvein/mcp-openfile-sdk')
}

/** 解析 `@chatvein/mcp-modsearch-sdk` CLI 入口（包内 dist/cli.js）。 */
export function resolveMcpModsearchServerEntry(): string {
  return resolveChatveinMcpCli('@chatvein/mcp-modsearch-sdk')
}

/** 解析 `@chatvein/mcp-vmsandbox-sdk` CLI 入口（包内 dist/cli.js）。 */
export function resolveMcpVmsandboxServerEntry(): string {
  return resolveChatveinMcpCli('@chatvein/mcp-vmsandbox-sdk')
}

/** 解析 `@chatvein/mcp-shellsandbox-sdk` CLI 入口 */
export function resolveMcpShellsandboxServerEntry(): string {
  return resolveChatveinMcpCli('@chatvein/mcp-shellsandbox-sdk')
}

/** 解析 `@chatvein/mcp-pyodide-sdk` CLI 入口（包内 dist/cli.js）。 */
export function resolveMcpPyodideServerEntry(): string {
  return resolveChatveinMcpCli('@chatvein/mcp-pyodide-sdk')
}

/**
 * 解析 `@playwright/mcp` CLI 入口（包内 cli.js）。
 */
export function resolveMcpPlaywrightServerEntry(): string {
  const pkgJson = requireFromHere.resolve('@playwright/mcp/package.json')
  return join(dirname(pkgJson), 'cli.js')
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
 * 挂 MCP vmsandbox（vm2 执行工作区 scripts/ 下的 Node 脚本）。
 */
export function createMcpVmsandboxServer(
  workspaceRoot: string,
  options?: {
    timeoutMs?: number
    maxOutputChars?: number
    allowAnyJs?: boolean
  },
): McpServerConnection {
  const root = workspaceRoot.trim()
  if (!root) {
    throw new Error('createMcpVmsandboxServer: workspaceRoot 不能为空')
  }
  const args = [resolveMcpVmsandboxServerEntry(), root]
  if (options?.timeoutMs && options.timeoutMs > 0) {
    args.push(`--timeout=${options.timeoutMs}`)
  }
  if (options?.maxOutputChars && options.maxOutputChars > 0) {
    args.push(`--max-output=${options.maxOutputChars}`)
  }
  if (options?.allowAnyJs) {
    args.push('--allow-any-js')
  }
  return {
    transport: 'stdio',
    command: process.execPath,
    args,
    env: electronRunAsNodeEnv(),
  }
}

/** 挂 MCP shellsandbox：LocalSandboxProvider 白名单 exec/git */
export function createMcpShellsandboxServer(
  workspaceRoot: string,
  options?: { timeoutMs?: number },
): McpServerConnection {
  const root = workspaceRoot.trim()
  if (!root) {
    throw new Error('createMcpShellsandboxServer: workspaceRoot 不能为空')
  }
  const args = [resolveMcpShellsandboxServerEntry(), root]
  if (options?.timeoutMs && options.timeoutMs > 0) {
    args.push(`--timeout=${options.timeoutMs}`)
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
 * 默认注入 `vmsandbox`（需 workspaceRoot；可用同名配置覆盖）。
 */
export function withDefaultMcpVmsandbox(
  workspaceRoot: string | undefined,
  servers: Record<string, McpServerConnection> | undefined,
  enabled = true,
): Record<string, McpServerConnection> | undefined {
  if (!enabled || !workspaceRoot?.trim()) return servers
  if (servers?.[MCP_VMSANDBOX_SERVER_NAME]) return servers
  return mergeMcpServers(
    { [MCP_VMSANDBOX_SERVER_NAME]: createMcpVmsandboxServer(workspaceRoot) },
    servers,
  )
}

/** 默认注入 `shellsandbox`（需 workspaceRoot；可用同名配置覆盖） */
export function withDefaultMcpShellsandbox(
  workspaceRoot: string | undefined,
  servers: Record<string, McpServerConnection> | undefined,
  enabled = true,
): Record<string, McpServerConnection> | undefined {
  if (!enabled || !workspaceRoot?.trim()) return servers
  if (servers?.[MCP_SHELLSANDBOX_SERVER_NAME]) return servers
  return mergeMcpServers(
    { [MCP_SHELLSANDBOX_SERVER_NAME]: createMcpShellsandboxServer(workspaceRoot) },
    servers,
  )
}

/**
 * 挂 MCP pyodide（Pyodide 执行工作区 scripts/ 下的 Python）。
 */
export function createMcpPyodideServer(
  workspaceRoot: string,
  options?: {
    timeoutMs?: number
    maxOutputChars?: number
    allowAnyPy?: boolean
  },
): McpServerConnection {
  const root = workspaceRoot.trim()
  if (!root) {
    throw new Error('createMcpPyodideServer: workspaceRoot 不能为空')
  }
  const args = [resolveMcpPyodideServerEntry(), root]
  if (options?.timeoutMs && options.timeoutMs > 0) {
    args.push(`--timeout=${options.timeoutMs}`)
  }
  if (options?.maxOutputChars && options.maxOutputChars > 0) {
    args.push(`--max-output=${options.maxOutputChars}`)
  }
  if (options?.allowAnyPy) {
    args.push('--allow-any-py')
  }
  return {
    transport: 'stdio',
    command: process.execPath,
    args,
    env: electronRunAsNodeEnv(),
  }
}

/**
 * 默认注入 `pyodide`（需 workspaceRoot；可用同名配置覆盖）。
 */
export function withDefaultMcpPyodide(
  workspaceRoot: string | undefined,
  servers: Record<string, McpServerConnection> | undefined,
  enabled = true,
): Record<string, McpServerConnection> | undefined {
  if (!enabled || !workspaceRoot?.trim()) return servers
  if (servers?.[MCP_PYODIDE_SERVER_NAME]) return servers
  return mergeMcpServers(
    { [MCP_PYODIDE_SERVER_NAME]: createMcpPyodideServer(workspaceRoot) },
    servers,
  )
}

/**
 * 挂 MCP Playwright（浏览器自动化；默认 headless）。
 * 不依赖 workspace。首次使用前需已安装浏览器：`pnpm exec playwright install chromium`。
 */
export function createMcpPlaywrightServer(options?: {
  /** 默认 true（桌面 Agent 更稳） */
  headless?: boolean
  browser?: 'chrome' | 'firefox' | 'webkit' | 'msedge'
  /** 额外 CLI 参数，如 `--caps=vision` */
  extraArgs?: string[]
}): McpServerConnection {
  const args = [resolveMcpPlaywrightServerEntry()]
  if (options?.headless !== false) {
    args.push('--headless')
  }
  if (options?.browser) {
    args.push(`--browser=${options.browser}`)
  }
  if (options?.extraArgs?.length) {
    args.push(...options.extraArgs)
  }
  return {
    transport: 'stdio',
    command: process.execPath,
    args,
    env: electronRunAsNodeEnv(),
  }
}

/**
 * 默认注入 `playwright`（不依赖 workspace；可用同名配置覆盖）。
 */
export function withDefaultMcpPlaywright(
  servers: Record<string, McpServerConnection> | undefined,
  enabled = true,
): Record<string, McpServerConnection> | undefined {
  if (!enabled) return servers
  if (servers?.[MCP_PLAYWRIGHT_SERVER_NAME]) return servers
  return mergeMcpServers(
    { [MCP_PLAYWRIGHT_SERVER_NAME]: createMcpPlaywrightServer() },
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
    // 覆盖官方长描述：利于向量检索区分度，并压缩进模型的 token
    return applyCatalogDescriptions(tools as StructuredToolInterface[])
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

/** 是否已拉到 vmsandbox MCP 工具 */
export function hasMcpVmsandboxTools(tools: StructuredToolInterface[]): boolean {
  const prefix = `${MCP_VMSANDBOX_SERVER_NAME}__`
  return tools.some((t) => t.name.startsWith(prefix))
}

/** 是否已拉到 shellsandbox MCP 工具 */
export function hasMcpShellsandboxTools(tools: StructuredToolInterface[]): boolean {
  const prefix = `${MCP_SHELLSANDBOX_SERVER_NAME}__`
  return tools.some((t) => t.name.startsWith(prefix))
}

/** 是否已拉到 pyodide MCP 工具 */
export function hasMcpPyodideTools(tools: StructuredToolInterface[]): boolean {
  const prefix = `${MCP_PYODIDE_SERVER_NAME}__`
  return tools.some((t) => t.name.startsWith(prefix))
}

/** 是否已拉到 playwright MCP 工具 */
export function hasMcpPlaywrightTools(tools: StructuredToolInterface[]): boolean {
  const prefix = `${MCP_PLAYWRIGHT_SERVER_NAME}__`
  return tools.some((t) => t.name.startsWith(prefix))
}
