/**
 * @chatvein/agents
 *
 * Agent runtime: LangChain createAgent (ReAct on LangGraph) for chat and group members.
 */

export const CHATVEIN_AGENTS_VERSION = '0.1.0'

export {
  createReactChatAgent,
  invokeReactChatAgent,
  extractFinalAssistantText,
  type CreateReactChatAgentOptions,
  type ReactChatAgent,
  type ReactChatInput,
  type ReactChatResult,
} from './react-agent'

export { defineAgentTool } from './define-tool'

export {
  HeuristicRouter,
  createHeuristicRouter,
  getDefaultHeuristicRouter,
  configureDefaultHeuristicRouter,
  L1HeuristicRouter,
  createL1Router,
  extractFacts,
  isGreetingOnly,
  createDefaultRules,
  DEFAULT_PROTOTYPES,
  DEFAULT_DICTS,
  resolveDict,
  RouteBm25Index,
  tokenizeForBm25,
  createL2Classifier,
  shouldEscalateToL2,
  StructuredL2Classifier,
  mergeL2Judgement,
  loadDefaultPrototypes,
  type HeuristicRouterOptions,
  type RouteInput,
  type HeuristicCtx,
  type HeuristicSession,
  type L2Classifier,
  type L2ClassifierOptions,
  type L2Judgement,
} from './routing'
