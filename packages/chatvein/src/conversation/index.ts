/**
 * 会话母图（ConversationGraph）公共导出。
 *
 * START → entry → {direct|agentic|orchestrated} → finalize → END
 * workers：direct（小工具人）/ general（通用+计划）/ code（编码+计划）
 * @see docs/conversation-graph-design.md
 * @see docs/conversation-graph-implementation.md
 */

export type {
  Band,
  BudgetPolicy,
  BudgetSpec,
  BudgetUsage,
  BudgetVerdict,
  ConversationHooks,
  ConversationLaneNode,
  ConversationRoute,
  Domain,
  Lane,
  OfficeArtifact,
  OfficePlanStep,
  OfficeState,
  PlanStep,
  TaskArtifact,
  TaskState,
  ToolsPolicy,
} from './types'

export {
  ConversationStateAnnotation,
  DEFAULT_OFFICE,
  DEFAULT_ROUTE,
  DEFAULT_TASK,
  cloneRoute,
  cloneTask,
  type ConversationState,
  type ConversationStateUpdate,
} from './state'

export {
  normalizeRoute,
  routeFromRouterPlan,
  selectConversationLane,
  type RouterPlanLike,
} from './route'

export {
  createBudgetTracker,
  budgetExhaustedText,
  type BudgetTracker,
} from './budget'

export {
  resolveTools,
  type ToolsByDomain,
  type ToolsResolver,
} from './tools'

export { extractFinalAssistantText } from '../shared'
export { finalizeNode, createFinalizeNode } from './finalize'

export {
  createConversationGraph,
  DEFAULT_RECURSION_LIMIT,
  type ConversationCompiledGraph,
  type ConversationGraph,
  type ConversationInvokeInput,
  type ConversationInvokeResult,
  type ConversationNodeName,
  type CreateConversationGraphOptions,
} from './graph'

export { entryNode, createEntryNode, lastUserText } from './entry'
export {
  createDirectLane,
  createOneShotNode,
  createReplyOnlyNode,
  selectDirectNode,
  DEFAULT_DIRECT_SYSTEM_PROMPT,
  type DirectLaneNode,
  type DirectLaneOptions,
} from './workers/direct'
export {
  createAgenticLane,
  type AgenticLaneOptions,
} from './lanes/agentic'
export {
  dispatchAgenticWorker,
  dispatchStandardWorker,
  normalizeWorkerDomain,
} from './lanes/agentic/dispatch'
export {
  createOrchestratedLane,
  DEFAULT_ORCHESTRATED_SYSTEM_PROMPT,
  type OrchestratedLaneOptions,
} from './lanes/orchestrated'

/** @deprecated 编排 persona；旧名保留兼容 */
export { DEFAULT_ORCHESTRATED_SYSTEM_PROMPT as DEFAULT_OFFICE_COMPLEX_SYSTEM_PROMPT } from './lanes/orchestrated'
/** @deprecated office 已并入 general；保留导出以免旧引用崩 */
export { DEFAULT_DIRECT_SYSTEM_PROMPT as DEFAULT_OFFICE_PIPELINE_SYSTEM_PROMPT } from './workers/direct'

export { createChatAgent } from './workers/general'
export { DEFAULT_CHAT_SYSTEM_PROMPT } from './workers/general/prompt'
export type {
  ChatAgent,
  ChatAgentInvokeInput,
  ChatAgentInvokeResult,
  CreateChatAgentOptions,
} from './workers/general'
export { DEFAULT_CODER_SYSTEM_PROMPT } from './workers/code/prompt'
