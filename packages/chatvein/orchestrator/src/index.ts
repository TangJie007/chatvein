/**
 * @chatvein/orchestrator
 *
 * LangGraph state machine: plan -> dispatch -> implement -> verify ->
 * diagnose -> fix -> integrate -> finalize, with conditional edges, file-based
 * checkpoints (crash resume) and global budget guards. P0 runs tasks serially.
 *
 * 外层 StateGraph（Plan-Execute）；implement/fix 节点内层跑 ReAct（@chatvein/agents
 * 的 createReactChatAgent + Forge 编码工具）。
 */

export const CHATVEIN_ORCHESTRATOR_VERSION = '0.1.0'

export { buildOrchestratorGraph, type OrchestratorDeps, ForgeState } from './graph'
export type { ForgeStateType } from './graph'
export { runForge, type RunForgeInput, type RunForgeResult } from './run'
export { createForgeTools, assertNotSecretPath, applyExactReplace, summarizeReplaceDiff, type ForgeToolsDeps } from './tools'
export { checkBudget, type GuardState, type GuardBreach } from './guards'
