/**
 * @chatvein/agents
 *
 * Chatvein agent 工厂包（纯 Node）：会话母图 / 分层路由 / 工具预筛。
 *
 * **推荐用法**：只用 `createChatveinAgents` —— 模型、分层路由、每轮工具筛选、
 * 预算表、persona 全部内置，调用方只给「模型 + 工具（可选）+ checkpointer（可选）」。
 *
 * ```ts
 * const agents = createChatveinAgents({
 *   model: 'deepseek-chat',
 *   apiKey,
 *   baseUrl,
 *   tools,
 * })
 * const { finalText, route } = await agents.invoke({ input: '惠阳天气', thread_id: 't1' })
 * ```
 *
 * 需要细粒度控制时再用下层工厂（`createConversationGraph` / `createRouterAgent` /
 * `createToolsFilterAgent`）；路由内部层细节见子路径 `@chatvein/agents/router`。
 */

export const CHATVEIN_AGENTS_VERSION = '0.1.0'

// ---------------------------------------------------------------------------
// 门面（唯一推荐入口）
// ---------------------------------------------------------------------------
export {
  createChatveinAgents,
  type ChatveinAgents,
  type ChatveinAgentsInvokeInput,
  type ChatveinAgentsOptions,
} from './agents'

// ---------------------------------------------------------------------------
// 模型
// ---------------------------------------------------------------------------
export {
  createChatModel,
  resolveChatModel,
  type ChatModelConfig,
  type ChatModelConnection,
  type CreateChatModelOptions,
} from './model'

// ---------------------------------------------------------------------------
// 会话母图
// ---------------------------------------------------------------------------
export {
  createConversationGraph,
  normalizeRoute,
  routeFromRouterPlan,
  selectConversationLane,
  dispatchAgenticWorker,
  dispatchStandardWorker,
  createAgenticLane,
  createOrchestratedLane,
  DEFAULT_RECURSION_LIMIT,
  DEFAULT_ROUTE,
  DEFAULT_TASK,
  DEFAULT_DIRECT_SYSTEM_PROMPT,
  DEFAULT_ORCHESTRATED_SYSTEM_PROMPT,
  DEFAULT_CHAT_SYSTEM_PROMPT,
  DEFAULT_CODER_SYSTEM_PROMPT,
  type ConversationGraph,
  type ConversationInvokeInput,
  type ConversationInvokeResult,
  type ConversationRoute,
  type ConversationState,
  type CreateConversationGraphOptions,
  type ConversationHooks,
  type TaskState,
  type ToolsByDomain,
  type ToolsResolver,
} from './conversation'

// ---------------------------------------------------------------------------
// 分层路由
// ---------------------------------------------------------------------------
export {
  createRouterAgent,
  deriveBudget,
  checkBudget,
  DEFAULT_BUDGET_TABLE,
  type RouterAgent,
  type RouterDecision,
  type RouterDecidedBy,
  type RouterInput,
  type CreateRouterAgentOptions,
  type Band,
  type BudgetPolicy,
  type BudgetSpec,
  type Domain,
  type Lane,
  type ToolsPolicy,
} from './router'

// ---------------------------------------------------------------------------
// 工具预筛
// ---------------------------------------------------------------------------
export {
  createToolsFilterAgent,
  type ToolsFilterAgent,
  type ToolsFilterInput,
  type ToolsFilterResult,
  type CreateToolsFilterAgentOptions,
} from './tools-filter'

// ---------------------------------------------------------------------------
// 共享
// ---------------------------------------------------------------------------
export {
  extractFinalAssistantText,
  lastHumanMessageText,
  historyBeforeLastHuman,
  toChatMessages,
  toLangChainMessages,
  type ChatMessage,
} from './shared'
