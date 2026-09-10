/**
 * 会话母图领域类型（对齐 docs/conversation-graph-design.md）。
 * Lane / Domain 与 router 词汇统一；Domain 仅 general | code。
 */

import type { Band, Domain, Lane, ToolsPolicy } from '../router/types'
import type { RouterDecision } from '../router/agent'
import type { ToolsFilterResult } from '../tools-filter/agent'
import type { ConversationState } from './state'

export type { Band, Domain, Lane, ToolsPolicy }
export type {
  BudgetPolicy,
  BudgetSpec,
  BudgetUsage,
  BudgetVerdict,
} from '../router/l0/budget'

/** 观测钩子（runtime 注入，供 thinking panel / 审批 UI） */
export interface ConversationHooks {
  /** 节点进入时回调；子图节点名形如 `direct:one_shot` */
  onNode?: (name: string, state: ConversationState) => void
  /** entry 内 router 产出完整决策时回调（含 decidedBy / safety） */
  onRoute?: (plan: RouterDecision) => void
  /** 每轮工具筛选结果回调（UI 可展示「本轮挂了哪些工具」） */
  onToolsFilter?: (result: ToolsFilterResult) => void
  /** `interrupt` 触发时回调 */
  onInterrupt?: (payload: unknown) => void
}

/** 母图执行所需的路由快照（由 RouterDecision 投影） */
export interface ConversationRoute {
  lane: Lane
  domain: Domain
  band: Band
  maxSteps: number
  toolsPolicy: ToolsPolicy
  query: {
    rewritten: string
    searchQuery?: string
    slots?: Record<string, unknown>
    intents?: string[]
  }
  reason?: string
}

export interface TaskArtifact {
  id: string
  path: string
  mime?: string
  role: 'input' | 'draft' | 'output'
  summary?: string
}

export interface PlanStep {
  id: string
  title: string
  kind: 'tool' | 'agent' | 'files' | 'human'
  /** 子步骤 worker：general | code */
  domain?: Domain
  status: 'pending' | 'doing' | 'done' | 'failed' | 'skipped'
  risk: 'low' | 'high'
  error?: string
}

export interface TaskState {
  intent?: string
  artifacts: TaskArtifact[]
  plan: PlanStep[]
  repairCount: number
  resultSummary?: string
}

/** @deprecated 使用 TaskArtifact */
export type OfficeArtifact = TaskArtifact
/** @deprecated 使用 PlanStep */
export type OfficePlanStep = PlanStep
/** @deprecated 使用 TaskState */
export type OfficeState = TaskState

/** 母图 lane 节点名（与 Lane 一致） */
export type ConversationLaneNode = Lane
