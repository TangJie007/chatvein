/**
 * @chatvein/tools
 *
 * Agent tool layer: catalog by category, LangChain community + builtin tools,
 * policy intersection, timeout / output truncation, workspace path jail.
 */

export const CHATVEIN_TOOLS_VERSION = '0.1.0'

export { TOOL_CATALOG, catalogById, catalogByCategory } from './catalog'
export { resolveChatTools, defaultChatToolIds } from './resolve'
export { resolveInWorkspace, truncateOutput, withTimeout } from './guards'
export { wrapToolGuards, defineBuiltinTool } from './wrap'

export type {
  ToolCategory,
  ToolCatalogEntry,
  ToolSecretKind,
  ToolSecrets,
  ResolveChatToolsOptions,
  StructuredToolInterface,
  ToolPolicy,
} from './types'
