/**
 * 会话母图组装：START → entry → {direct|agentic|orchestrated} → finalize → END
 *
 * 阶段 A 交付：**entry → direct → finalize** 全链路可编译、可 invoke、可 resume。
 * `agentic` / `orchestrated` 为显式占位（阶段 B / C），进入时返回明确提示而非静默错误。
 *
 * 红线：循环、持久化、interrupt 一律用 LangGraph 能力；worker 用 createAgent / createDeepAgent。
 * @see docs/conversation-graph-implementation.md §3 / §11
 */
import { HumanMessage, type BaseMessage } from '@langchain/core/messages'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { RunnableConfig } from '@langchain/core/runnables'
import type { StructuredToolInterface } from '@langchain/core/tools'
import {
  END,
  START,
  StateGraph,
  type BaseCheckpointSaver,
  type CompiledStateGraph,
} from '@langchain/langgraph'
import type {
  CreateDeepAgentParams,
  FilesystemPermission,
} from 'deepagents'
import type { AnyAgentMiddleware } from 'langchain'
import type { RouterDecision, RouterInput } from '../router/agent'
import { createEntryNode } from './entry/resolve-route'
import { createFinalizeNode } from './finalize'
import { createDirectLane } from './workers/direct'
import { createAgenticLane } from './lanes/agentic'
import { createOrchestratedLane } from './lanes/orchestrated'
import { normalizeRoute, selectConversationLane } from './route'
import {
  ConversationStateAnnotation,
  type ConversationState,
  type ConversationStateUpdate,
} from './state'
import type { ToolsByDomain, ToolsResolver } from './tools'
import type {
  BudgetPolicy,
  ConversationHooks,
  ConversationRoute,
  Domain,
  Lane,
  TaskState,
} from './types'

/** 母图节点名 */
export type ConversationNodeName =
  | 'entry'
  | 'direct'
  | 'agentic'
  | 'orchestrated'
  | 'finalize'

/** 默认递归上限（direct 档远用不到；预留给阶段 B/C 的 worker 子图） */
export const DEFAULT_RECURSION_LIMIT = 64

export interface CreateConversationGraphOptions {
  /** 主模型（direct / agentic worker 共用） */
  model?: LanguageModelLike
  /** runtime 注入的候选工具池；工厂内再按 domain + toolsPolicy 过滤 */
  tools?: StructuredToolInterface[]
  /** 可选：按领域预切好的工具表（优先于对 tools 的二次过滤） */
  toolsByDomain?: ToolsByDomain
  /** 每轮工具再筛选（内置工具筛选器挂在这里；不传则不筛） */
  toolsResolver?: ToolsResolver
  middleware?: AnyAgentMiddleware[]
  /** 宿主注入；本包不创建 SqliteSaver */
  checkpointer?: BaseCheckpointSaver
  /** 阶段 B 接入 `workers/code`（createDeepAgent）时使用 */
  coder?: {
    backend?: CreateDeepAgentParams['backend']
    permissions?: FilesystemPermission[]
  }
  /** 锁定执行形态（等同 UI 工作模式） */
  lockLane?: Lane
  lockDomain?: Domain
  /** 未预填 route 时：图内 entry 调用（`createRouterAgent.route`） */
  router?: { route(input: RouterInput): Promise<RouterDecision> }
  /** 传给 entry → router 的附加输入（attachments / signal 等；history 默认可从 messages 推） */
  routerInput?: Omit<RouterInput, 'text'>
  budgetPolicy?: BudgetPolicy
  /** 贯通 worker invoke */
  signal?: AbortSignal
  hooks?: ConversationHooks
  name?: string
}

export interface ConversationInvokeInput {
  messages?: BaseMessage[]
  input?: string
  route?: Partial<ConversationRoute>
  /** 预填 route 时建议显式传 true；省略时按「是否传了 route」推断 */
  routeReady?: boolean
  /** 每轮建议清掉，避免 checkpoint 残留导致 entry 误判早退 */
  finalText?: string
  thread_id?: string
  signal?: AbortSignal
}

export interface ConversationInvokeResult {
  finalText: string
  task: TaskState
  route: ConversationRoute
  messages: BaseMessage[]
  /** 完整终态（调试 / runtime 需要） */
  state: ConversationState
}

export type ConversationCompiledGraph = CompiledStateGraph<
  ConversationState,
  ConversationStateUpdate,
  ConversationNodeName | typeof START
>

export interface ConversationGraph {
  graph: ConversationCompiledGraph
  invoke(
    input: ConversationInvokeInput,
    config?: RunnableConfig,
  ): Promise<ConversationInvokeResult>
}

function buildConversationGraph(options: CreateConversationGraphOptions) {
  const hooks = options.hooks
  // entry：写本轮 route（图内调 router；reject/clarify 写 finalText → finalize）
  const entry = createEntryNode({
    ...(options.lockLane ? { lockLane: options.lockLane } : {}),
    ...(options.lockDomain ? { lockDomain: options.lockDomain } : {}),
    ...(options.routerInput ? { routerInput: options.routerInput } : {}),
    ...(options.router ? { router: options.router } : {}),
    ...(hooks ? { hooks } : {}),
  })

  const laneOptions = {
    ...(options.model ? { model: options.model } : {}),
    ...(options.tools ? { tools: options.tools } : {}),
    ...(options.toolsByDomain ? { toolsByDomain: options.toolsByDomain } : {}),
    ...(options.toolsResolver ? { toolsResolver: options.toolsResolver } : {}),
    ...(options.middleware ? { middleware: options.middleware } : {}),
    ...(options.budgetPolicy ? { budgetPolicy: options.budgetPolicy } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.name ? { name: options.name } : {}),
    ...(hooks ? { hooks } : {}),
  }

  const direct = createDirectLane(laneOptions)
  const agentic = createAgenticLane(laneOptions)
  const orchestrated = createOrchestratedLane(laneOptions)

  const finalize = createFinalizeNode(hooks ? { hooks } : {})

  return new StateGraph(ConversationStateAnnotation)
    .addNode('entry', entry)
    .addNode('direct', direct)
    .addNode('agentic', agentic)
    .addNode('orchestrated', orchestrated)
    .addNode('finalize', finalize)
    .addEdge(START, 'entry')
    .addConditionalEdges('entry', (state: ConversationState) =>
      // entry 已写 finalText（安全拒绝 / 澄清）→ 跳过 lane
      state.finalText ? 'finalize' : selectConversationLane(state.route),
    )
    .addEdge('direct', 'finalize')
    .addEdge('agentic', 'finalize')
    .addEdge('orchestrated', 'finalize')
    .addEdge('finalize', END)
}

/**
 * 创建会话母图。
 *
 * - lane 决定图形状，domain 只决定 worker / 工具集。
 * - 未预填 route 时由 entry 调 `router`；reject / clarify 在 entry 写 finalText 后直达 finalize。
 */
export function createConversationGraph(
  options: CreateConversationGraphOptions = {},
): ConversationGraph {
  const compiled = buildConversationGraph(options).compile({
    ...(options.name ? { name: options.name } : {}),
    ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
  }) as ConversationCompiledGraph

  return {
    graph: compiled,
    async invoke(
      input: ConversationInvokeInput,
      config?: RunnableConfig,
    ): Promise<ConversationInvokeResult> {
      const messages: BaseMessage[] =
        input.messages && input.messages.length > 0
          ? [...input.messages]
          : input.input
            ? [new HumanMessage(input.input)]
            : []

      if (messages.length === 0) {
        throw new Error('conversation/graph.invoke: messages or input is required')
      }

      const signal = input.signal ?? options.signal
      const routeReady = input.routeReady ?? Boolean(input.route)

      const runConfig: RunnableConfig = {
        ...(config ?? {}),
        configurable: {
          ...(config?.configurable ?? {}),
          ...(input.thread_id ? { thread_id: input.thread_id } : {}),
        },
        ...(signal ? { signal } : {}),
        recursionLimit: config?.recursionLimit ?? DEFAULT_RECURSION_LIMIT,
      }

      const state = (await compiled.invoke(
        {
          messages,
          ...(input.route ? { route: normalizeRoute(input.route) } : {}),
          routeReady,
          // 清掉 checkpoint 残留，避免 entry 条件边误进 finalize
          finalText: input.finalText ?? '',
        },
        runConfig,
      )) as ConversationState

      return {
        finalText: state.finalText || '',
        task: state.task,
        route: state.route,
        messages: state.messages,
        state,
      }
    },
  }
}
