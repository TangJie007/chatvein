/**
 * Chat 启发式路由契约（design/09）。
 * 与 Forge TaskComplexity 语义族对齐，但不共用枚举以免耦合。
 */
import { z } from 'zod'
import type { ModelTier } from '../core/types'

/** 复杂度分档 */
export type ComplexityBand = 'trivial' | 'simple' | 'standard' | 'complex' | 'unknown'

/**
 * 工具策略：
 * - `none`：禁止工具
 * - `unknown`：L1 不确定，需 L2 再判
 * - `full`：完整工具（仍受角色白名单）
 */
export type ToolPolicy = 'none' | 'unknown' | 'full'

export interface RoutePolicy {
  modelTier: ModelTier
  tools: ToolPolicy
  maxSteps: number
  memoryRecall: boolean
  /** Agent 可创建子 Agent；不是拉群 */
  allowSubAgents?: boolean
  /** 仅 UI：提示用户拉群；禁止 agents 建群 */
  hintUserCreateGroup?: boolean
  /** 仅 UI：提示用户派 Forge */
  hintUserForge?: boolean
}

export interface Bm25Hit {
  id: string
  score: number
  band: Exclude<ComplexityBand, 'unknown'>
  tools?: ToolPolicy
}

export interface RouteTerminal {
  kind: 'slash' | 'mention' | 'empty' | 'local_command'
  payload?: Record<string, unknown>
}

export interface RouteDecision {
  band: ComplexityBand
  confident: boolean
  policy: RoutePolicy
  score: number
  reasons: string[]
  ruleIds: string[]
  bm25Hits?: Bm25Hit[]
  terminal?: RouteTerminal
}

export interface RoutePrototype {
  id: string
  text: string
  band: Exclude<ComplexityBand, 'unknown'>
  tools: ToolPolicy
  lang?: 'zh'
  tags?: string[]
}

export const ComplexityBandSchema = z.enum([
  'trivial',
  'simple',
  'standard',
  'complex',
  'unknown',
])

export const ToolPolicySchema = z.enum(['none', 'unknown', 'full'])

export const RoutePolicySchema = z.object({
  modelTier: z.enum(['strong', 'medium', 'weak']),
  tools: ToolPolicySchema,
  maxSteps: z.number().int().nonnegative(),
  memoryRecall: z.boolean(),
  allowSubAgents: z.boolean().optional(),
  hintUserCreateGroup: z.boolean().optional(),
  hintUserForge: z.boolean().optional(),
})

export const RouteDecisionSchema = z.object({
  band: ComplexityBandSchema,
  confident: z.boolean(),
  policy: RoutePolicySchema,
  score: z.number(),
  reasons: z.array(z.string()),
  ruleIds: z.array(z.string()),
  bm25Hits: z
    .array(
      z.object({
        id: z.string(),
        score: z.number(),
        band: z.enum(['trivial', 'simple', 'standard', 'complex']),
        tools: ToolPolicySchema.optional(),
      }),
    )
    .optional(),
  terminal: z
    .object({
      kind: z.enum(['slash', 'mention', 'empty', 'local_command']),
      payload: z.record(z.string(), z.unknown()).optional(),
    })
    .optional(),
})

export function parseRouteDecision(input: unknown): RouteDecision {
  return RouteDecisionSchema.parse(input)
}
