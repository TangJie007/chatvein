/**
 * `createChatveinAgents` —— 本包**唯一推荐入口**。
 *
 * 内置的东西（调用方无需再装配）：
 * - 模型档位：一份配置派生 main / fast（路由 L2 + 工具筛选）/ strong（路由 L3 升级）
 * - 分层路由 L0→L1→L2→L3（含安全护栏、LRU 缓存、阈值、超时）
 * - 每轮工具筛选（弱模挑选本轮工具，≤`passthroughK` 个候选时不调模型）
 * - 预算表 / persona / lane 默认提示 / 递归上限
 *
 * 调用方只需给「模型 + 工具（可选）+ checkpointer（可选）」。
 */
import type { BaseMessage } from '@langchain/core/messages'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { BaseCheckpointSaver } from '@langchain/langgraph'
import { LRUCache } from 'lru-cache'
import { createRouterAgent, type CreateRouterAgentOptions, type RouterAgent } from './router/agent'
import {
  createToolsFilterAgent,
  type CreateToolsFilterAgentOptions,
  type ToolsFilterAgent,
} from './tools-filter/agent'
import {
  createConversationGraph,
  type ConversationGraph,
  type ConversationInvokeResult,
} from './conversation/graph'
import type { ToolsByDomain, ToolsResolver } from './conversation/tools'
import type {
  BudgetPolicy,
  ConversationHooks,
  ConversationRoute,
  Domain,
  Lane,
} from './conversation/types'
import { resolveModelBundle, type ChatveinModelConfig } from './model'

/** 门面选项：除 `model` 外全部可省 */
export interface ChatveinAgentsOptions {
  /**
   * 模型。传配置对象则按档位派生；传已建好的模型实例则四档共用。
   * 本地单模型（Ollama / LM Studio）直接传实例即可。
   */
  model: ChatveinModelConfig | LanguageModelLike
  /** 候选工具全集；包内按 domain + toolsPolicy + 弱模筛选逐层收窄 */
  tools?: StructuredToolInterface[]
  /** 按领域预切好的工具表（优先于对 tools 的二次过滤） */
  toolsByDomain?: ToolsByDomain
  /** 宿主注入（本包不创建 SqliteSaver） */
  checkpointer?: BaseCheckpointSaver
  /** 锁定执行形态（等同 UI 工作模式） */
  lockLane?: Lane
  lockDomain?: Domain
  /** 覆盖预算表（缺省用内置 `DEFAULT_BUDGET_TABLE`） */
  budgetPolicy?: BudgetPolicy
  /** 贯通 worker / router invoke */
  signal?: AbortSignal
  hooks?: ConversationHooks
  /** 图名（trace 用） */
  name?: string
  /**
   * 内置分层路由。
   * - 省略 / 对象：启用（对象用于覆盖阈值 / 超时 / 安全规则 / 语义检索端口等）
   * - `false`：关闭，母图按默认档 `direct·general·trivial` 执行
   */
  router?: false | Omit<CreateRouterAgentOptions, 'fastModel' | 'strongModel'>
  /**
   * 内置每轮工具筛选。
   * - 省略 / 对象：启用（对象用于覆盖 `passthroughK` / `timeoutMs` / `temperature`）
   * - `false`：关闭，候选工具全集直接进 lane
   */
  toolsFilter?: false | Omit<CreateToolsFilterAgentOptions, 'model'>
  /** 工具筛选结果缓存条数（同文本不重复调弱模） */
  toolsFilterCacheMax?: number
}

export interface ChatveinAgentsInvokeInput {
  /** 本轮用户文本（与 `messages` 二选一） */
  input?: string
  /** 完整消息列表（含历史） */
  messages?: BaseMessage[]
  /** 预填路由 → 跳过图内路由（runtime 已跑过 Router 时用） */
  route?: Partial<ConversationRoute>
  /** 会话线程 ID（checkpointer 用） */
  thread_id?: string
  signal?: AbortSignal
}

export interface ChatveinAgents {
  /** 会话母图（高级用法：自定义条件边 / stream） */
  conversation: ConversationGraph
  /** 内置路由（关闭时为 undefined） */
  router?: RouterAgent
  /** 内置工具筛选（关闭时为 undefined） */
  toolsFilter?: ToolsFilterAgent
  /** 跑一轮：路由 → 工具筛选 → lane 执行 → finalize */
  invoke(input: ChatveinAgentsInvokeInput): Promise<ConversationInvokeResult>
}

/**
 * 一次性装配「路由 + 工具筛选 + 会话母图」。
 */
export function createChatveinAgents(
  options: ChatveinAgentsOptions,
): ChatveinAgents {
  if (!options?.model) {
    throw new Error('createChatveinAgents: options.model is required')
  }
  const models = resolveModelBundle(options.model)
  const tools = options.tools ?? []
  const hooks = options.hooks

  const router =
    options.router === false
      ? undefined
      : createRouterAgent({
          fastModel: models.fast,
          strongModel: models.strong,
          ...(options.router ?? {}),
        })

  const toolsFilter =
    options.toolsFilter === false || tools.length === 0
      ? undefined
      : createToolsFilterAgent({
          model: models.filter,
          ...(options.toolsFilter ?? {}),
        })

  const filterCache = new LRUCache<string, StructuredToolInterface[]>({
    max: options.toolsFilterCacheMax ?? 64,
  })

  const toolsResolver: ToolsResolver | undefined = toolsFilter
    ? async ({ text, pool }) => {
        if (!text.trim() || pool.length === 0) return undefined
        const cached = filterCache.get(text)
        if (cached) return cached
        const result = await toolsFilter.filter({
          message: text,
          tools: pool,
          ...(options.signal ? { signal: options.signal } : {}),
        })
        hooks?.onToolsFilter?.(result)
        const picked = result.tools.length ? result.tools : pool
        filterCache.set(text, picked)
        return picked
      }
    : undefined

  const conversation = createConversationGraph({
    model: models.main,
    ...(tools.length ? { tools } : {}),
    ...(options.toolsByDomain ? { toolsByDomain: options.toolsByDomain } : {}),
    ...(toolsResolver ? { toolsResolver } : {}),
    ...(options.checkpointer ? { checkpointer: options.checkpointer } : {}),
    ...(options.lockLane ? { lockLane: options.lockLane } : {}),
    ...(options.lockDomain ? { lockDomain: options.lockDomain } : {}),
    ...(options.budgetPolicy ? { budgetPolicy: options.budgetPolicy } : {}),
    ...(options.signal ? { signal: options.signal } : {}),
    ...(options.name ? { name: options.name } : {}),
    ...(router ? { router } : {}),
    ...(hooks ? { hooks } : {}),
  })

  return {
    conversation,
    ...(router ? { router } : {}),
    ...(toolsFilter ? { toolsFilter } : {}),
    invoke(input: ChatveinAgentsInvokeInput): Promise<ConversationInvokeResult> {
      return conversation.invoke({
        ...(input.input !== undefined ? { input: input.input } : {}),
        ...(input.messages ? { messages: input.messages } : {}),
        ...(input.route ? { route: input.route, routeReady: true } : {}),
        ...(input.thread_id ? { thread_id: input.thread_id } : {}),
        ...(input.signal ? { signal: input.signal } : {}),
      })
    },
  }
}
