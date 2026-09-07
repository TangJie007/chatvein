/**
 * @chatvein/tools
 *
 * Agent tool layer: catalog + MCP-first external tools + builtin jail,
 * policy intersection, timeout / output truncation.
 */

export const CHATVEIN_TOOLS_VERSION = '0.1.0'

export {
  TOOL_CATALOG,
  TOOL_CATALOG_GROUPS,
  catalogById,
  catalogByCategory,
  catalogByGroup,
  catalogGroupById,
} from './catalog'
export {
  STATE_FILESYSTEM_GROUP_ID,
  STATE_FILESYSTEM_TOOL_NAMES,
  STATE_FILESYSTEM_TOOLS,
  isStateFilesystemToolId,
  stateFilesystemCustomDescriptions,
  normalizeStateFilesystemAllowlist,
  selectStateFilesystemCatalogEntries,
  stateFilesystemIndexInputs,
  type StateFilesystemToolName,
} from './catalog/tools-state-filesystem'
export {
  TOOL_EMBED_DESC_MAX_CHARS,
  TOOL_EMBED_TEXT_MAX_CHARS,
  catalogEmbedText,
  catalogEntryForTool,
  humanizeToolName,
  mcpServerOf,
  schemaParamNames,
  toolEmbedText,
  toolEmbedTexts,
  type ToolEmbedInput,
  type ToolEmbedTextOptions,
} from './tool-embed'
export { resolveChatTools, defaultChatToolIds } from './resolve'
export { resolveInWorkspace, truncateOutput, withTimeout } from './guards'
export { wrapToolGuards, defineBuiltinTool, wrapToolOutput } from './wrap'
export { summarizeToolsForDebug } from './debug'
export {
  ToolVectorIndex,
  TOOL_INDEX_SCOPE,
  TOOL_INDEX_KIND,
  TOOL_PRESCREEN_TOP_K,
  TOOL_VECTOR_MIN_SCORE,
  type ToolEmbedder,
  type ToolVectorStore,
  type ToolIndexRecord,
  type ToolIndexHit,
  type ToolVectorIndexInput,
  type ToolVectorIndexOptions,
} from './tool-vector-index'
export {
  ToolBm25Index,
  toolBm25Doc,
  reciprocalRankFusion,
  type ToolBm25Doc,
  type ToolBm25Hit,
  type ToolBm25IndexInput,
  type ToolBm25IndexOptions,
} from './tool-bm25-index'
export { tokenizeForBm25 } from './tokenize-cjk'
export {
  keywordSelect,
  llmSelectTools,
  fitToolsWithinBudget,
  isResponseFormatUnsupported,
  type ToolCandidate,
  type LlmSelectToolsResult,
  type LlmSelectToolsStatus,
} from './select'
export {
  estimateToolTokens,
  estimateToolSchemaTokens,
  estimateToolsTokens,
} from './tool-tokens'
export {
  inferContextWindow,
  computeToolBudgetTokens,
  DEFAULT_CONTEXT_WINDOW,
  type ToolBudgetOptions,
} from './model-context'
export {
  TOOL_SELECT_SYSTEM_PROMPT,
  toolSelectChatPromptTemplate,
  formatToolSelectPromptMessages,
  formatToolSelectList,
  buildToolSelectPromptVars,
  type ToolSelectPromptVars,
  type ToolSelectListItem,
} from './select-prompt'
export {
  loadMcpTools,
  parseMcpServersJson,
  createMcpOpenfileServer,
  createMcpModsearchServer,
  createMcpVmsandboxServer,
  createMcpShellsandboxServer,
  createMcpPyodideServer,
  createMcpPlaywrightServer,
  resolveMcpOpenfileServerEntry,
  resolveMcpModsearchServerEntry,
  resolveMcpVmsandboxServerEntry,
  resolveMcpShellsandboxServerEntry,
  resolveMcpPyodideServerEntry,
  resolveMcpPlaywrightServerEntry,
  mergeMcpServers,
  withDefaultMcpOpenfile,
  withDefaultMcpModsearch,
  withDefaultMcpVmsandbox,
  withDefaultMcpShellsandbox,
  withDefaultMcpPyodide,
  withDefaultMcpPlaywright,
  hasMcpOpenfileTools,
  hasMcpModsearchTools,
  hasMcpVmsandboxTools,
  hasMcpShellsandboxTools,
  hasMcpPyodideTools,
  hasMcpPlaywrightTools,
  MCP_OPENFILE_SERVER_NAME,
  MCP_MODSEARCH_SERVER_NAME,
  MCP_VMSANDBOX_SERVER_NAME,
  MCP_SHELLSANDBOX_SERVER_NAME,
  MCP_PYODIDE_SERVER_NAME,
  MCP_PLAYWRIGHT_SERVER_NAME,
} from './mcp'
export { applyCatalogDescriptions, resolveCatalogDescription, setToolDescription } from './catalog-descriptions'

export type {
  ToolCategory,
  ToolCatalogEntry,
  ToolCatalogGroup,
  ToolSecretKind,
  ToolSecrets,
  ResolveChatToolsOptions,
  StructuredToolInterface,
  ToolPolicy,
} from './types'
export type { McpServerConnection, LoadMcpToolsOptions } from './mcp'
