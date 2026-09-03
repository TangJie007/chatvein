/**
 * LangGraph 状态机类型（@chatvein/orchestrator 的 StateGraph schema）。
 *
 * 对应 PRD 5.3.3 / 02-方案设计 §4.1。状态在节点间流转、每个节点后写 checkpoint，
 * resume 时从最近 checkpoint 重建。字段统一 camelCase（PRD 表格的 snake_case 为逻辑名）。
 */
import { DEFAULT_BUDGET, emptyTokenStat, type Budget, type TokenStat } from './types'
import type { TaskTree } from './task'
import type { BuildStatus, TestReport } from './verifier'

/** 运行整体状态 */
export type RunStatus = 'running' | 'paused' | 'done' | 'aborted'

/** 文件索引项：上下文只放摘要 + 函数签名，需要时再精确读（PRD 5.3.5） */
export interface FileSummary {
  /** 文件内容摘要 */
  summary: string
  /** 关键函数/导出签名 */
  signatures?: string[]
  /** 最近读取时的 hash，用于判断是否变更 */
  hash?: string
}

/**
 * 主状态机状态。节点：plan → dispatch → implement → verify → diagnose → fix → integrate → finalize。
 */
export interface GraphState {
  runId: string
  workspacePath: string
  requirementPath: string
  /** 需求编译产出（任务树） */
  taskTree: TaskTree
  /** 当前处理的任务（并行时多个；一期串行，通常 0/1 个） */
  currentTaskIds: string[]
  /** 路径 → 文件摘要/签名，避免重复读取 */
  fileIndex: Record<string, FileSummary>
  /** 最近一次构建结果 */
  buildStatus: BuildStatus
  /** 最近一次自测结构化结果（失败项） */
  testReport?: TestReport
  /** 失败归因结论（责任文件 + 根因） */
  rootCause?: string
  /** 当前任务重试次数 */
  retryCount: number
  /** 累计 Token（按模型分档） */
  tokenUsage: TokenStat
  /** 预算上限与阈值（判定在 @chatvein/context BudgetGuard） */
  budget: Budget
  /** 运行状态 */
  status: RunStatus
  /** 最近一次 checkpoint id（resume 用） */
  checkpointId?: string
}

/** 状态机节点名（与 02-方案设计 §4.2 对齐） */
export type GraphNode =
  | 'plan'
  | 'dispatch'
  | 'implement'
  | 'verify'
  | 'diagnose'
  | 'fix'
  | 'integrate'
  | 'finalize'

/**
 * 构造初始 GraphState。tokenUsage/budget 给默认值，taskTree 为空，
 * 由 plan 节点填充。
 */
export function createInitialState(input: {
  runId: string
  workspacePath: string
  requirementPath: string
  budget?: Budget
}): GraphState {
  return {
    runId: input.runId,
    workspacePath: input.workspacePath,
    requirementPath: input.requirementPath,
    taskTree: [],
    currentTaskIds: [],
    fileIndex: {},
    buildStatus: 'unknown',
    retryCount: 0,
    tokenUsage: emptyTokenStat(),
    budget: input.budget ?? DEFAULT_BUDGET,
    status: 'running',
  }
}
