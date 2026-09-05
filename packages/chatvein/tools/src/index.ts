/**
 * @chatvein/tools
 *
 * Agent tool layer: catalog + MCP-first external tools + builtin jail,
 * policy intersection, timeout / output truncation.
 */

export const CHATVEIN_TOOLS_VERSION = '0.1.0'

export { TOOL_CATALOG, catalogById, catalogByCategory } from './catalog'
export { resolveChatTools, defaultChatToolIds } from './resolve'
export { resolveInWorkspace, truncateOutput, withTimeout } from './guards'
export { wrapToolGuards, defineBuiltinTool } from './wrap'
export { summarizeToolsForDebug } from './debug'
export {
  loadMcpTools,
  parseMcpServersJson,
  createMcpFilesystemServer,
  resolveMcpFilesystemServerEntry,
  mergeMcpServers,
  withDefaultMcpFilesystem,
  hasMcpFilesystemTools,
  MCP_FILESYSTEM_SERVER_NAME,
} from './mcp'

export type {
  ToolCategory,
  ToolCatalogEntry,
  ToolSecretKind,
  ToolSecrets,
  ResolveChatToolsOptions,
  StructuredToolInterface,
  ToolPolicy,
} from './types'
export type { McpServerConnection, LoadMcpToolsOptions } from './mcp'
