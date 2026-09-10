/**
 * general worker 的编排工厂。
 *
 * 编排形态（图驱动）：先「计划」→ 再逐项执行；**每项执行前先做工具筛选**
 * （只把该步骤需要的工具交给执行器），**每项完成后模型自检**（达标即确认、否则修正重试），
 * 全部完成后产出「设计实现文档」。整条链路是一个 LangGraph 状态图，
 * 步骤间用 `next` 通道驱动条件边循环，不依赖宿主侧事件。
 *
 * 对外契约（ChatAgent.invoke）保持不变：消息进、{ content, messages } 出，
 * 其中 `content` 为最终的设计实现文档。runtime / UI 无需改动。
 */
import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  type BaseMessage,
} from '@langchain/core/messages'
import type { Callbacks } from '@langchain/core/callbacks/manager'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { StructuredToolInterface } from '@langchain/core/tools'
import type { RunnableConfig } from '@langchain/core/runnables'
import {
  Annotation,
  END,
  START,
  StateGraph,
  messagesStateReducer,
  type BaseCheckpointSaver,
  type CompiledStateGraph,
} from '@langchain/langgraph'
import { createAgent, type AnyAgentMiddleware } from 'langchain'
import {
  contentToString,
  extractFinalAssistantText,
  extractJsonObject,
  lastHumanMessageText,
  toLangChainMessages,
  type ChatMessage,
} from '../../../shared'
import {
  CHECKER_SYSTEM_PROMPT,
  EXECUTOR_SYSTEM_PROMPT,
  FINALIZER_SYSTEM_PROMPT,
  PLANNER_SYSTEM_PROMPT,
  TOOL_SELECT_SYSTEM_PROMPT,
} from './prompt'

/** 单轮调用输入 */
export interface ChatAgentInvokeInput {
  /** 用户本轮消息 */
  message: string
  /** 可选历史（不含本轮） */
  history?: ChatMessage[]
  /** LangGraph 递归上限（一次模型/工具调用计 1）；计划-执行图默认放宽到 256 */
  recursionLimit?: number
  /** 外部取消信号 */
  signal?: AbortSignal
  /**
   * 会话线程 ID（写入 `configurable.thread_id`）。
   * 启用 checkpointer 时建议传入，以便跨轮恢复状态。
   */
  threadId?: string
  /**
   * 透传给 `graph.invoke` 的 LangChain callbacks（工具起止、子 span 等）。
   * 模型级 callbacks 仍挂在 ChatModel 上；这里补图级事件（如 tool start/end）。
   */
  callbacks?: Callbacks
}

/** 单轮调用结果 */
export interface ChatAgentInvokeResult {
  /** 最终设计实现文档（含回复） */
  content: string
  /** 完整消息轨迹（含 ToolMessage） */
  messages: BaseMessage[]
}

/** createChatAgent 选项 */
export interface CreateChatAgentOptions {
  /** 聊天模型（须支持 tool calling；无工具时任意 ChatModel 即可） */
  model: LanguageModelLike
  /** 工具列表；空数组 / 省略 = 纯问答 */
  tools?: StructuredToolInterface[]
  /** Agent 名（trace / 多 Agent 区分） */
  name?: string
  /** 中间件 */
  middleware?: AnyAgentMiddleware[]
  /** 状态检查点（跨轮持久化） */
  checkpointer?: BaseCheckpointSaver
}

/** 主聊天 agent 句柄 */
export interface ChatAgent {
  /** 跑一轮「计划 → 逐项执行(含工具筛选/自检) → 设计文档」，返回文档与消息轨迹 */
  invoke(input: ChatAgentInvokeInput): Promise<ChatAgentInvokeResult>
}

// ---------------------------------------------------------------------------
// 计划-执行图的内部状态
// ---------------------------------------------------------------------------

/** 计划中的单个步骤 */
interface PlanItem {
  id: string
  title: string
  instruction: string
  acceptCriteria: string
  /** 执行该步要用的工具 name（工具筛选阶段填充） */
  tools: string[]
  /** 已尝试次数（含重试） */
  retries: number
  /** 自检未通过时记录的原因，供重试修正 */
  correction?: string
  /** 自检结论 */
  passed?: boolean
}

/** 单步执行结果 */
interface ItemResult {
  index: number
  title: string
  instruction: string
  output: string
  passed?: boolean
  reason?: string
}

type Next = 'loop' | 'finalize'

const PlanExecuteAnnotation = Annotation.Root({
  messages: Annotation<BaseMessage[]>({
    reducer: messagesStateReducer,
    default: () => [],
  }),
  task: Annotation<string>({
    reducer: (_p, n) => n ?? '',
    default: () => '',
  }),
  plan: Annotation<PlanItem[]>({
    reducer: (_p, n) => n ?? [],
    default: () => [],
  }),
  currentIndex: Annotation<number>({
    reducer: (_p, n) => n ?? 0,
    default: () => 0,
  }),
  itemResults: Annotation<ItemResult[]>({
    reducer: (_p, n) => n ?? [],
    default: () => [],
  }),
  designDoc: Annotation<string>({
    reducer: (_p, n) => n ?? '',
    default: () => '',
  }),
  next: Annotation<Next>({
    reducer: (_p, n) => n ?? 'loop',
    default: () => 'loop',
  }),
})

type State = typeof PlanExecuteAnnotation.State
type StateUpdate = typeof PlanExecuteAnnotation.Update

/** 单项未通过时的最大重试次数（自检修正后再跑一次） */
const MAX_RETRIES = 1

function clonePlan(plan: PlanItem[]): PlanItem[] {
  return plan.map((p) => ({ ...p, tools: [...(p.tools ?? [])] }))
}

function updateResult(
  results: ItemResult[],
  index: number,
  passed: boolean,
  reason: string,
): ItemResult[] {
  const exists = results.find((r) => r.index === index)
  if (!exists) {
    return [...results, { index, title: '', instruction: '', output: '', passed, reason }]
  }
  return results.map((r) => (r.index === index ? { ...r, passed, reason } : r))
}

// ---------------------------------------------------------------------------
// 纯文本 / JSON 调用封装（复用共享的 contentToString / extractJsonObject）
// ---------------------------------------------------------------------------

async function callModelText(
  model: LanguageModelLike,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<string> {
  const res = await model.invoke(
    [new SystemMessage(system), new HumanMessage(user)],
    signal ? { signal } : undefined,
  )
  return contentToString((res as { content: unknown }).content)
}

async function callModelJson<T>(
  model: LanguageModelLike,
  system: string,
  user: string,
  signal?: AbortSignal,
): Promise<T> {
  const text = await callModelText(model, system, user, signal)
  return extractJsonObject(text) as T
}

// ---------------------------------------------------------------------------
// 图节点
// ---------------------------------------------------------------------------

/**
 * 计划节点：把任务拆成有序步骤；失败则退化为「直接回答」单步。
 */
async function plannerNode(
  state: State,
  ctx: { model: LanguageModelLike; signal?: AbortSignal },
): Promise<StateUpdate> {
  const task = lastHumanMessageText(state.messages) || state.task
  let items: PlanItem[] = []
  try {
    const raw = await callModelJson<
      Array<{ title?: string; instruction?: string; acceptCriteria?: string }>
    >(
      ctx.model,
      PLANNER_SYSTEM_PROMPT,
      `用户任务：\n${task}\n\n请输出计划步骤的 JSON 数组。`,
      ctx.signal,
    )
    if (Array.isArray(raw) && raw.length) {
      items = raw.map((it, idx) => ({
        id: `step-${idx + 1}`,
        title: String(it.title || `步骤 ${idx + 1}`),
        instruction: String(it.instruction || ''),
        acceptCriteria: String(it.acceptCriteria || ''),
        tools: [],
        retries: 0,
      }))
    }
  } catch {
    // 规划失败：退化为单步直接回答
  }
  if (!items.length) {
    items = [
      {
        id: 'step-1',
        title: '直接回答',
        instruction: task,
        acceptCriteria: '给出完整回答',
        tools: [],
        retries: 0,
      },
    ]
  }
  return { plan: items, currentIndex: 0, itemResults: [], next: 'loop' }
}

/**
 * 工具筛选节点：针对当前步骤，从完整工具池里挑出需要的工具。
 * 模型选错或不选时回退到全部工具，保证可执行。
 */
async function selectToolsNode(
  state: State,
  ctx: { model: LanguageModelLike; tools: StructuredToolInterface[]; signal?: AbortSignal },
): Promise<StateUpdate> {
  const i = state.currentIndex
  const item = state.plan[i]
  if (!item) return { next: 'finalize' }

  if (!ctx.tools.length) {
    const plan = clonePlan(state.plan)
    plan[i] = { ...item, tools: [] }
    return { plan }
  }

  const catalog = ctx.tools.map((t) => `- ${t.name}: ${t.description ?? ''}`).join('\n')
  let selected: string[] = []
  try {
    const raw = await callModelJson<string[]>(
      ctx.model,
      TOOL_SELECT_SYSTEM_PROMPT,
      `当前步骤：\n标题：${item.title}\n要完成：${item.instruction}\n验收：${item.acceptCriteria}\n\n可用工具：\n${catalog}\n\n输出需要的工具 name 数组。`,
      ctx.signal,
    )
    if (Array.isArray(raw)) selected = raw.map(String)
  } catch {
    // 降级到全部工具
  }

  const valid = selected.filter((n) => ctx.tools.some((t) => t.name === n))
  const chosen = valid.length ? valid : ctx.tools.map((t) => t.name)

  const plan = clonePlan(state.plan)
  plan[i] = { ...item, tools: chosen }
  return { plan }
}

/**
 * 执行节点：用筛选后的工具跑一个单步 ReAct，产出该步结果。
 * 每一步都带上「前面已完成步骤」的上下文，保证连续性。
 */
async function executeItemNode(
  state: State,
  ctx: {
    model: LanguageModelLike
    tools: StructuredToolInterface[]
    name?: string
    middleware?: AnyAgentMiddleware[]
    signal?: AbortSignal
  },
): Promise<StateUpdate> {
  const i = state.currentIndex
  const item = state.plan[i]
  if (!item) return {}

  const tools = ctx.tools.filter((t) => item.tools?.includes(t.name))
  const execAgent = createAgent({
    model: ctx.model,
    tools,
    systemPrompt: EXECUTOR_SYSTEM_PROMPT,
    ...(ctx.name ? { name: `${ctx.name}:exec` } : {}),
    ...(ctx.middleware ? { middleware: ctx.middleware } : {}),
  })

  const prior = state.itemResults.filter((r) => r.index < i)
  const execMessages: BaseMessage[] = [
    new SystemMessage(EXECUTOR_SYSTEM_PROMPT),
    new HumanMessage(
      `用户任务：\n${state.task}\n\n【当前步骤 ${i + 1}/${state.plan.length}】\n标题：${item.title}\n` +
        `要完成：${item.instruction}\n验收标准：${item.acceptCriteria}`,
    ),
    ...prior.map(
      (r) => new AIMessage(`【已完成步骤 ${r.index + 1}：${r.title}】\n${r.output}`),
    ),
    ...(item.correction
      ? [new HumanMessage(`上一次这一步未通过验收，请修正：${item.correction}`)]
      : []),
  ]

  const res = await execAgent.invoke(
    { messages: execMessages },
    ctx.signal ? { signal: ctx.signal } : undefined,
  )
  const output = extractFinalAssistantText((res as { messages: BaseMessage[] }).messages)

  const itemResults = [
    ...state.itemResults.filter((r) => r.index !== i),
    {
      index: i,
      title: item.title,
      instruction: item.instruction,
      output,
      passed: undefined as boolean | undefined,
    },
  ]
  return { itemResults }
}

/**
 * 自检节点：模型判断该步是否达标。
 * - 未通过且仍可重试 → 记录 correction，保持 currentIndex 不变（下一轮重试同一步）。
 * - 未通过但已用尽重试 / 已通过 → currentIndex 前进；若已无后续步骤则进入收尾。
 */
async function checkItemNode(
  state: State,
  ctx: { model: LanguageModelLike; signal?: AbortSignal },
): Promise<StateUpdate> {
  const i = state.currentIndex
  const item = state.plan[i]
  const r = state.itemResults.find((x) => x.index === i)

  let passed = true
  let reason = ''
  try {
    const out = await callModelJson<{ passed?: boolean; reason?: string }>(
      ctx.model,
      CHECKER_SYSTEM_PROMPT,
      `步骤：${item?.title}\n要完成：${item?.instruction}\n验收：${item?.acceptCriteria}\n\n实际产出：\n${r?.output ?? ''}`,
      ctx.signal,
    )
    passed = Boolean(out?.passed)
    reason = String(out?.reason ?? '')
  } catch {
    passed = true
    reason = '自检不可用，默认通过'
  }

  const plan = clonePlan(state.plan)
  const cur = plan[i]
  const retries = (cur.retries ?? 0) + 1
  plan[i] = { ...cur, retries, passed, correction: passed ? undefined : reason }

  let next: Next = 'loop'
  let currentIndex = i
  if (!passed && retries <= MAX_RETRIES) {
    // 重试同一步：保持 currentIndex 不变
    currentIndex = i
  } else {
    currentIndex = i + 1
    if (currentIndex >= plan.length) next = 'finalize'
  }

  return {
    plan,
    currentIndex,
    itemResults: updateResult(state.itemResults, i, passed, reason),
    next,
  }
}

/** 收尾节点：基于计划与每步产出，生成「设计实现文档」。 */
async function finalizeNode(
  state: State,
  ctx: { model: LanguageModelLike; signal?: AbortSignal },
): Promise<StateUpdate> {
  const planText = state.plan
    .map((p, idx) => `${idx + 1}. ${p.title}（验收：${p.acceptCriteria}）`)
    .join('\n')
  const resultsText = state.itemResults
    .map(
      (r) =>
        `${r.index + 1}. ${r.title}\n状态：${r.passed === false ? '未通过' : '通过'}\n产出：${r.output}`,
    )
    .join('\n\n')

  let doc = ''
  try {
    doc = await callModelText(
      ctx.model,
      FINALIZER_SYSTEM_PROMPT,
      `原始任务：\n${state.task}\n\n计划：\n${planText}\n\n各步产出：\n${resultsText}`,
      ctx.signal,
    )
  } catch {
    doc = `# 设计实现文档\n\n（文档生成失败，以下是执行结果）\n\n${resultsText}`
  }

  return {
    designDoc: doc,
    messages: [...state.messages, new AIMessage(doc)],
  }
}

// ---------------------------------------------------------------------------
// 工厂
// ---------------------------------------------------------------------------

/**
 * 创建 general 计划-执行 agent（LangGraph 状态图）。
 * 对外只暴露「消息进、文档+轨迹出」，不自研循环。
 */
export function createChatAgent(options: CreateChatAgentOptions): ChatAgent {
  if (!options?.model) {
    throw new Error('createChatAgent: options.model is required')
  }

  const model = options.model
  const allTools = options.tools ?? []
  const name = options.name
  const middleware = options.middleware

  const buildCtx = (signal?: AbortSignal) => ({ model, signal })

  const workflow = new StateGraph(PlanExecuteAnnotation)
    .addNode('planner', (state, config?: RunnableConfig) =>
      plannerNode(state, buildCtx(config?.signal)),
    )
    .addNode('selectTools', (state, config?: RunnableConfig) =>
      selectToolsNode(state, { ...buildCtx(config?.signal), tools: allTools }),
    )
    .addNode('executeItem', (state, config?: RunnableConfig) =>
      executeItemNode(state, {
        ...buildCtx(config?.signal),
        tools: allTools,
        ...(name ? { name } : {}),
        ...(middleware ? { middleware } : {}),
      }),
    )
    .addNode('checkItem', (state, config?: RunnableConfig) =>
      checkItemNode(state, buildCtx(config?.signal)),
    )
    .addNode('finalize', (state, config?: RunnableConfig) =>
      finalizeNode(state, buildCtx(config?.signal)),
    )
    .addEdge(START, 'planner')
    .addEdge('planner', 'selectTools')
    .addEdge('selectTools', 'executeItem')
    .addEdge('executeItem', 'checkItem')
    .addConditionalEdges('checkItem', (state: State) =>
      state.next === 'finalize' ? 'finalize' : 'selectTools',
    )
    .addEdge('finalize', END)

  const compiled = workflow.compile({
    ...(options.checkpointer !== undefined ? { checkpointer: options.checkpointer } : {}),
  }) as CompiledStateGraph<State, StateUpdate, string>

  return {
    async invoke(input: ChatAgentInvokeInput): Promise<ChatAgentInvokeResult> {
      const messages = toLangChainMessages({
        input: input.message,
        history: input.history,
      })

      const runConfig: RunnableConfig = {
        recursionLimit: input.recursionLimit ?? 256,
        ...(input.signal ? { signal: input.signal } : {}),
        ...(input.threadId ? { configurable: { thread_id: input.threadId } } : {}),
        ...(input.callbacks ? { callbacks: input.callbacks } : {}),
      }

      const state = (await compiled.invoke(
        {
          messages,
          task: input.message,
          plan: [],
          currentIndex: 0,
          itemResults: [],
          designDoc: '',
          next: 'loop',
        },
        runConfig,
      )) as State

      return {
        content: state.designDoc || extractFinalAssistantText(state.messages),
        messages: state.messages,
      }
    },
  }
}
