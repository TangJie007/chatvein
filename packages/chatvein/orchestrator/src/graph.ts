/**
 * Forge 主编排状态机（LangGraph StateGraph）。
 *
 * 外层 = Plan-Execute 任务级状态机：
 *   plan → dispatch → implement → verify → diagnose → fix → integrate → finalize
 * 内层 = implement/fix 节点内的 ReAct 小循环（createReactChatAgent + 编码工具）。
 *
 * 硬规则：任务"完成"只能由 verify 节点的结构化结果判定，模型不得自述完成。
 * 护栏：token / 步数 / 墙钟 / 连续失败，任一触发即熔断进 finalize。
 */
import { Annotation, StateGraph, START, END } from '@langchain/langgraph'
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { StructuredToolInterface } from '@langchain/core/tools'
import {
  type GraphState,
  type Task,
  type TaskTree,
  type VerifyResult,
  type TokenStat,
  type Budget,
  type BuildStatus,
  type ModelTier,
  emptyTokenStat,
  addTokenUsage,
  isVerifyPassed,
  nextRunnableTasks,
  TERMINAL_TASK_STATUS,
} from '@chatvein/common'
import type { SandboxProvider } from '@chatvein/sandbox'
import type { TraceSink } from '@chatvein/observability'
import { compileRequirement } from '@chatvein/compiler'
import { verify as runVerify } from '@chatvein/verifier'
import { createReactChatAgent, invokeReactChatAgent } from '@chatvein/agents'
import { readFile } from 'node:fs/promises'
import { createForgeTools } from './tools'
import { checkBudget, type GuardState } from './guards'
import { IMPLEMENT_SYSTEM, FIX_SYSTEM, DIAGNOSE_SYSTEM, SUMMARIZE_SYSTEM } from './prompts'

/** 编排依赖（由 core 装配注入） */
export interface OrchestratorDeps {
  sandbox: SandboxProvider
  trace: TraceSink
  /** 按档取 LangChain 模型（喂给内层 ReAct） */
  lcModel: (tier: ModelTier) => LanguageModelLike
  /** 按档取最小模型接口（diagnose/summarize 等纯文本节点用，省 token） */
  textModel: (
    tier: ModelTier,
  ) => (messages: Array<{ role: 'system' | 'user'; content: string }>) => Promise<{
    content: string
    usage: TokenStat['total']
    model: string
  }>
  /** 验证命令覆盖（缺省 npm run build / npm test） */
  buildCommand?: string[]
  testCommand?: string[]
  skipBuild?: boolean
  /** 需求编译策略 */
  compileStrategy?: 'single' | 'sections'
  /** 用户取消：透传给内层 ReAct / 工具 exec */
  signal?: AbortSignal
}

/** 图内部状态（在 GraphState 基础上增加流转字段；各 channel 用 last-write-wins reducer） */
export const ForgeState = Annotation.Root({
  /** 本次运行 id（与 runs/<runId>、checkpoint thread 对齐） */
  runId: Annotation<string>({ default: () => '', reducer: (_o, n) => n }),
  /** 沙箱/项目工作区绝对路径（工具 jail 根） */
  workspacePath: Annotation<string>({ default: () => '', reducer: (_o, n) => n }),
  /** 需求文档路径（plan 可读盘；Chat 档多为会话 memory/requirement-*.md） */
  requirementPath: Annotation<string>({ default: () => '', reducer: (_o, n) => n }),
  /** 需求正文缓存（避免每节点重复读文件；空则按 requirementPath 再读） */
  requirementText: Annotation<string>({ default: () => '', reducer: (_o, n) => n }),
  /** plan 编译出的任务树（含 status / acceptance） */
  taskTree: Annotation<TaskTree>({ default: () => [], reducer: (_o, n) => n }),
  /** 本轮 dispatch 选出的待办任务 id（一期串行，通常 0/1 个） */
  currentTaskIds: Annotation<string[]>({ default: () => [], reducer: (_o, n) => n }),
  /** 当前正在 implement/verify/fix 的任务对象；无任务时为 null */
  currentTask: Annotation<Task | null>({ default: () => null, reducer: (_o, n) => n }),
  /** 最近一次构建结果：unknown | pass | fail */
  buildStatus: Annotation<BuildStatus>({ default: () => 'unknown', reducer: (_o, n) => n }),
  /** 最近一次 verify/integrate 的结构化验收结果（完成判定唯一依据） */
  lastVerify: Annotation<VerifyResult | null>({ default: () => null, reducer: (_o, n) => n }),
  /** diagnose 产出的失败归因（喂给 fix） */
  rootCause: Annotation<string>({ default: () => '', reducer: (_o, n) => n }),
  /** 当前任务已走 diagnose→fix 的次数 */
  retryCount: Annotation<number>({ default: () => 0, reducer: (_o, n) => n }),
  /** 累计 token（按模型分档汇总） */
  tokenUsage: Annotation<TokenStat>({ default: () => emptyTokenStat(), reducer: (_o, n) => n }),
  /** 预算护栏：maxTokens / maxSteps / maxWallClockMs / maxConsecutiveFailures */
  budget: Annotation<Budget>({
    default: () => ({ maxTokens: 0, maxSteps: 30, maxWallClockMs: 0, maxConsecutiveFailures: 3 }),
    reducer: (_o, n) => n,
  }),
  /** 运行整体状态：running | paused | done | aborted */
  status: Annotation<GraphState['status']>({ default: () => 'running', reducer: (_o, n) => n }),
  /** 已执行外层节点步数（护栏计数） */
  steps: Annotation<number>({ default: () => 0, reducer: (_o, n) => n }),
  /** 连续 verify 失败次数（超阈值熔断） */
  consecutiveFailures: Annotation<number>({ default: () => 0, reducer: (_o, n) => n }),
  /** 运行开始时间戳 ms（墙钟护栏） */
  startedAt: Annotation<number>({ default: () => Date.now(), reducer: (_o, n) => n }),
  /** finalize 写入的交付摘要（回传 Chat / report） */
  finalSummary: Annotation<string>({ default: () => '', reducer: (_o, n) => n }),
  /** 未达终态或失败的任务 id 列表 */
  failedTasks: Annotation<string[]>({ default: () => [], reducer: (_o, n) => n }),
})

export type ForgeStateType = typeof ForgeState.State

function guardOf(s: ForgeStateType): GuardState {
  return { steps: s.steps, consecutiveFailures: s.consecutiveFailures, startedAt: s.startedAt }
}

function patchTask(tree: TaskTree, id: string, patch: Partial<Task>): TaskTree {
  return tree.map((t) => (t.id === id ? { ...t, ...patch } : t))
}

/** 构造编排图并返回可 invoke 的 compiled graph */
export function buildOrchestratorGraph(deps: OrchestratorDeps) {
  const tools: StructuredToolInterface[] = createForgeTools({
    sandbox: deps.sandbox,
    signal: deps.signal,
    onToolCall: async (info) => {
      await deps.trace.emit('tool_call', {
        name: info.name,
        durationMs: info.durationMs,
        payload: {
          argSize: info.argSize,
          resultSize: info.resultSize,
          truncated: info.truncated,
          ...(info.error ? { error: info.error } : {}),
        },
      })
    },
  })

  // ── plan：需求编译 ──────────────────────────────────────────────
  const plan = async (state: ForgeStateType) => {
    await deps.trace.emit('node_enter', { name: 'plan' })
    let markdown = state.requirementText
    if (!markdown) {
      markdown = await readFile(state.requirementPath, 'utf8')
    }
    const tree = compileRequirement({
      markdown,
      requirementPath: state.requirementPath,
      strategy: deps.compileStrategy ?? 'sections',
    })
    await deps.trace.emit('node_exit', {
      name: 'plan',
      payload: { taskCount: tree.length, tasks: tree.map((t) => ({ id: t.id, title: t.title })) },
    })
    return { taskTree: tree, steps: state.steps + 1 }
  }

  // ── dispatch：选下一个可调度任务（一期串行，取首个） ─────────────
  const dispatch = async (state: ForgeStateType) => {
    await deps.trace.emit('node_enter', { name: 'dispatch' })
    const runnable = nextRunnableTasks(state.taskTree)
    const next = runnable[0] ?? null
    await deps.trace.emit('node_exit', {
      name: 'dispatch',
      payload: next ? { taskId: next.id, title: next.title } : { noMoreTasks: true },
    })
    return {
      currentTask: next,
      currentTaskIds: next ? [next.id] : [],
      retryCount: 0,
      rootCause: '',
      steps: state.steps + 1,
    }
  }

  // ── implement：内层 ReAct 写代码 ────────────────────────────────
  const implement = async (state: ForgeStateType) => {
    const task = state.currentTask
    await deps.trace.emit('node_enter', { name: 'implement', payload: { taskId: task?.id } })
    if (!task) return { steps: state.steps + 1 }

    const tree = patchTask(state.taskTree, task.id, { status: 'running' })
    const agent = createReactChatAgent({
      model: deps.lcModel('strong'),
      tools,
      systemPrompt: IMPLEMENT_SYSTEM,
      name: 'forge-implement',
    })
    const userMsg = `任务 ${task.id}：${task.title}\n\n验收标准：\n- ${task.acceptance.join('\n- ')}\n\n请在工作区内实现并自行跑测试验证。`
    const result = await invokeReactChatAgent(agent, {
      message: userMsg,
      recursionLimit: 40,
      signal: deps.signal,
    })

    await deps.trace.emit('model_call', {
      name: 'strong',
      payload: { node: 'implement', totalTokens: result.usage.totalTokens },
    })
    await deps.trace.emit('node_exit', {
      name: 'implement',
      payload: { taskId: task.id, summary: result.content.slice(0, 500) },
    })
    return {
      taskTree: tree,
      tokenUsage: mergeUsage(state.tokenUsage, result.usage),
      steps: state.steps + 1,
    }
  }

  // ── verify：构建 + 测试（无模型，结构化验收） ────────────────────
  const verify = async (state: ForgeStateType) => {
    await deps.trace.emit('node_enter', { name: 'verify' })
    const result = await runVerify({
      sandbox: deps.sandbox,
      buildCommand: deps.buildCommand,
      testCommand: deps.testCommand,
      skipBuild: deps.skipBuild,
    })
    const passed = isVerifyPassed(result)
    await deps.trace.emit('verify', {
      name: 'verify',
      payload: {
        buildStatus: result.buildStatus,
        passed,
        testFailed: result.test?.failed ?? 0,
        testPassed: result.test?.passed ?? 0,
        failures: result.test?.failures?.slice(0, 10).map((f) => f.name) ?? [],
      },
    })
    return {
      lastVerify: result,
      buildStatus: result.buildStatus,
      steps: state.steps + 1,
    }
  }

  // ── diagnose：中模型归因 ────────────────────────────────────────
  const diagnose = async (state: ForgeStateType) => {
    await deps.trace.emit('node_enter', { name: 'diagnose' })
    const v = state.lastVerify
    const errorFrames = formatVerifyForDiagnose(v)
    const res = await deps.textModel('medium')([
      { role: 'system', content: DIAGNOSE_SYSTEM },
      {
        role: 'user',
        content: `任务：${state.currentTask?.title ?? '(集成)'}\n构建状态：${state.buildStatus}\n失败信息：\n${errorFrames}`,
      },
    ])
    await deps.trace.emit('model_call', { name: res.model, payload: { node: 'diagnose' } })
    await deps.trace.emit('node_exit', { name: 'diagnose', payload: { rootCause: res.content.slice(0, 300) } })
    return {
      rootCause: res.content,
      tokenUsage: mergeUsage(state.tokenUsage, res.usage),
      steps: state.steps + 1,
    }
  }

  // ── fix：内层 ReAct 定向修复 ────────────────────────────────────
  const fix = async (state: ForgeStateType) => {
    await deps.trace.emit('node_enter', { name: 'fix' })
    const task = state.currentTask
    const agent = createReactChatAgent({
      model: deps.lcModel('strong'),
      tools,
      systemPrompt: FIX_SYSTEM,
      name: 'forge-fix',
    })
    const userMsg = `任务：${task?.title ?? '(集成)'}\n\n诊断结论：\n${state.rootCause}\n\n失败详情：\n${formatVerifyForDiagnose(state.lastVerify)}\n\n请做最小修复并复测。`
    const result = await invokeReactChatAgent(agent, {
      message: userMsg,
      recursionLimit: 40,
      signal: deps.signal,
    })
    await deps.trace.emit('model_call', {
      name: 'strong',
      payload: { node: 'fix', totalTokens: result.usage.totalTokens },
    })
    await deps.trace.emit('node_exit', {
      name: 'fix',
      payload: { summary: result.content.slice(0, 500) },
    })
    return {
      retryCount: state.retryCount + 1,
      tokenUsage: mergeUsage(state.tokenUsage, result.usage),
      steps: state.steps + 1,
    }
  }

  // ── integrate：全部任务完成后的全量回归 ─────────────────────────
  const integrate = async (state: ForgeStateType) => {
    await deps.trace.emit('node_enter', { name: 'integrate' })
    const result = await runVerify({
      sandbox: deps.sandbox,
      buildCommand: deps.buildCommand,
      testCommand: deps.testCommand,
      skipBuild: deps.skipBuild,
    })
    const passed = isVerifyPassed(result)
    await deps.trace.emit('verify', {
      name: 'integrate',
      payload: {
        passed,
        buildStatus: result.buildStatus,
        testFailed: result.test?.failed ?? 0,
        failures: result.test?.failures?.slice(0, 10).map((f) => f.name) ?? [],
      },
    })
    return {
      lastVerify: result,
      buildStatus: result.buildStatus,
      steps: state.steps + 1,
    }
  }

  // ── finalize：汇总 + 标记状态 ───────────────────────────────────
  const finalize = async (state: ForgeStateType) => {
    await deps.trace.emit('node_enter', { name: 'finalize' })
    const passed = state.lastVerify ? isVerifyPassed(state.lastVerify) : false
    const failedTasks = state.taskTree.filter((t) => !TERMINAL_TASK_STATUS.has(t.status) || t.status === 'failed').map((t) => t.id)

    let summary = `运行结束。构建：${state.buildStatus}；`
    if (state.lastVerify?.test) {
      summary += `测试 ${state.lastVerify.test.passed} 通过 / ${state.lastVerify.test.failed} 失败。`
    }
    summary += passed ? '整体验收通过。' : '存在未通过项。'

    // 可选：弱模型生成交付总结（失败也不阻断）
    try {
      const res = await deps.textModel('weak')([
        { role: 'system', content: SUMMARIZE_SYSTEM },
        { role: 'user', content: summary },
      ])
      summary = res.content
    } catch {
      // 弱模型不可用时用规则摘要
    }

    await deps.trace.emit('node_exit', {
      name: 'finalize',
      payload: { passed, failedTasks, summary: summary.slice(0, 800) },
    })
    return {
      status: passed ? ('done' as const) : ('aborted' as const),
      finalSummary: summary,
      failedTasks,
      steps: state.steps + 1,
    }
  }

  // ── 条件边 ──────────────────────────────────────────────────────
  const afterPlan = (state: ForgeStateType) => (state.taskTree.length > 0 ? 'dispatch' : 'finalize')

  const afterDispatch = (state: ForgeStateType) => {
    if (!state.currentTask) return 'integrate'
    if (checkBudget(state.budget, state.tokenUsage, guardOf(state))) return 'finalize'
    return 'implement'
  }

  const afterImplement = (state: ForgeStateType) => {
    if (checkBudget(state.budget, state.tokenUsage, guardOf(state))) return 'finalize'
    return 'verify'
  }

  const afterVerify = (state: ForgeStateType) => {
    const passed = state.lastVerify ? isVerifyPassed(state.lastVerify) : false
    if (passed) {
      // 标记当前任务通过，回 dispatch 取下一个
      return 'markPassed'
    }
    // 失败：预算/重试内 → diagnose；否则标记失败跳过
    if (checkBudget(state.budget, state.tokenUsage, guardOf(state))) return 'markFailed'
    if (state.retryCount >= 3) return 'markFailed'
    return 'diagnose'
  }

  // 标记节点（无模型，纯状态更新）
  const markPassed = async (state: ForgeStateType) => {
    const id = state.currentTask?.id
    await deps.trace.emit('info', { name: 'task_passed', payload: { taskId: id } })
    return {
      taskTree: id ? patchTask(state.taskTree, id, { status: 'passed' }) : state.taskTree,
      consecutiveFailures: 0,
      steps: state.steps + 1,
    }
  }
  const markFailed = async (state: ForgeStateType) => {
    const id = state.currentTask?.id
    await deps.trace.emit('error', {
      name: 'task_failed',
      payload: { taskId: id, retries: state.retryCount, rootCause: state.rootCause.slice(0, 300) },
    })
    return {
      taskTree: id ? patchTask(state.taskTree, id, { status: 'failed' }) : state.taskTree,
      consecutiveFailures: state.consecutiveFailures + 1,
      failedTasks: id ? [...state.failedTasks, id] : state.failedTasks,
      steps: state.steps + 1,
    }
  }

  const afterFix = (state: ForgeStateType) => {
    if (checkBudget(state.budget, state.tokenUsage, guardOf(state))) return 'markFailed'
    return 'verify'
  }

  const afterIntegrate = (state: ForgeStateType) => {
    const passed = state.lastVerify ? isVerifyPassed(state.lastVerify) : false
    if (passed) return 'finalize'
    if (checkBudget(state.budget, state.tokenUsage, guardOf(state))) return 'finalize'
    // 集成失败且还有重试预算：归因后修复（无当前任务）
    if (state.retryCount >= 3) return 'finalize'
    return 'diagnose'
  }

  const graph = new StateGraph(ForgeState)
    .addNode('plan', plan)
    .addNode('dispatch', dispatch)
    .addNode('implement', implement)
    .addNode('verify', verify)
    .addNode('diagnose', diagnose)
    .addNode('fix', fix)
    .addNode('integrate', integrate)
    .addNode('finalize', finalize)
    .addNode('markPassed', markPassed)
    .addNode('markFailed', markFailed)
    .addEdge(START, 'plan')
    .addConditionalEdges('plan', afterPlan, {
      dispatch: 'dispatch',
      finalize: 'finalize',
    })
    .addConditionalEdges('dispatch', afterDispatch, {
      implement: 'implement',
      integrate: 'integrate',
      finalize: 'finalize',
    })
    .addConditionalEdges('implement', afterImplement, {
      verify: 'verify',
      finalize: 'finalize',
    })
    .addConditionalEdges('verify', afterVerify, {
      markPassed: 'markPassed',
      diagnose: 'diagnose',
      markFailed: 'markFailed',
    })
    .addEdge('markPassed', 'dispatch')
    .addEdge('markFailed', 'dispatch')
    .addEdge('diagnose', 'fix')
    .addConditionalEdges('fix', afterFix, {
      verify: 'verify',
      markFailed: 'markFailed',
    })
    .addConditionalEdges('integrate', afterIntegrate, {
      finalize: 'finalize',
      diagnose: 'diagnose',
    })
    .addEdge('finalize', END)

  return graph
}

// ── 辅助 ──────────────────────────────────────────────────────────

function mergeUsage(stat: TokenStat, usage: TokenStat['total']): TokenStat {
  // LangChain agent 聚合的 usage 是合计 TokenUsage；按 'agent' 桶并入
  const byModel = { ...stat.byModel }
  const key = 'agent'
  byModel[key] = addTokenUsage(byModel[key] ?? emptyTokenUsage0(), usage)
  const total = addTokenUsage(stat.total, usage)
  return { byModel, total }
}

function emptyTokenUsage0(): TokenStat['total'] {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

function formatVerifyForDiagnose(v: VerifyResult | null): string {
  if (!v) return '(无验证结果)'
  const parts: string[] = []
  if (!v.build.ok) {
    parts.push(`[构建失败] ${v.build.command}\n${(v.build.output ?? v.build.error ?? '').slice(0, 1500)}`)
  }
  if (v.test && v.test.failed > 0) {
    parts.push(
      `[测试失败] ${v.test.check.command}（${v.test.failed} 个失败）\n` +
        v.test.failures
          .slice(0, 8)
          .map((f) => `- ${f.name}${f.assertion ? `：${f.assertion}` : ''}\n${(f.stackFrames ?? []).join('\n')}`)
          .join('\n'),
    )
  }
  return parts.join('\n\n').slice(0, 3000)
}
