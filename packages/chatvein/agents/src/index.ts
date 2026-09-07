/**
 * @chatvein/agents
 *
 * Agent runtime: LangChain createAgent (ReAct on LangGraph) for chat and group members.
 */

export const CHATVEIN_AGENTS_VERSION = '0.1.0'

export {
  createReactChatAgent,
  invokeReactChatAgent,
  streamReactChatAgent,
  extractFinalAssistantText,
  aggregateTokenUsage,
  tokenUsageFromMessage,
  type CreateReactChatAgentOptions,
  type ReactChatAgent,
  type ReactChatInput,
  type ReactChatResult,
  type ReactStreamHandlers,
} from './react-agent'

export {
  WorkspaceCheckpointer,
  type WorkspaceCheckpointerOptions,
} from './checkpointer'

export { defineAgentTool } from './define-tool'

export {
  HeuristicRouter,
  createHeuristicRouter,
  getDefaultHeuristicRouter,
  configureDefaultHeuristicRouter,
  L1HeuristicRouter,
  createL1Router,
  decideL1,
  extractFacts,
  isGreetingOnly,
  isSelfIntro,
  ZH_DICT,
  resolveDict,
  policyForBand,
  createL2Classifier,
  shouldEscalateToL2,
  StructuredL2Classifier,
  mergeL2Judgement,
  type HeuristicRouterOptions,
  type RouteInput,
  type HeuristicCtx,
  type HeuristicSession,
  type L2Classifier,
  type L2ClassifierOptions,
  type L2Judgement,
} from './routing'
