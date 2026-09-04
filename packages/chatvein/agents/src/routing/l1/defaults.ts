import type { ComplexityBand, ModelTier, RoutePolicy, ToolPolicy } from '@chatvein/common'
import { clamp } from 'es-toolkit'

export interface ScoreTable {
  simpleMax: number
  standardMax: number
  /** score 落在此区间且无硬 override → unknown 灰区倾向 */
  greyLow: number
  greyHigh: number
}

export const DEFAULT_SCORE_TABLE: ScoreTable = {
  simpleMax: 25,
  standardMax: 55,
  greyLow: 18,
  greyHigh: 32,
}

export function bandFromScore(score: number, table: ScoreTable = DEFAULT_SCORE_TABLE): Exclude<ComplexityBand, 'unknown' | 'trivial'> {
  if (score <= table.simpleMax) return 'simple'
  if (score <= table.standardMax) return 'standard'
  return 'complex'
}

export function policyForBand(
  band: ComplexityBand,
  extras: Partial<RoutePolicy> = {},
): RoutePolicy {
  const base = bandPolicy(band)
  return mergePolicy(base, extras)
}

function bandPolicy(band: ComplexityBand): RoutePolicy {
  switch (band) {
    case 'trivial':
      return { modelTier: 'weak', tools: 'none', maxSteps: 0, memoryRecall: false }
    case 'simple':
      return { modelTier: 'weak', tools: 'none', maxSteps: 2, memoryRecall: false }
    case 'standard':
      return { modelTier: 'medium', tools: 'full', maxSteps: 8, memoryRecall: true }
    case 'complex':
      return {
        modelTier: 'strong',
        tools: 'full',
        maxSteps: 16,
        memoryRecall: true,
        allowSubAgents: true,
      }
    case 'unknown':
    default:
      return { modelTier: 'medium', tools: 'full', maxSteps: 8, memoryRecall: true }
  }
}

const TOOL_RANK: Record<'none' | 'full', number> = { none: 0, full: 1 }

export function maxToolPolicy(a: ToolPolicy, b: ToolPolicy): ToolPolicy {
  // unknown 不参与强度 max；合成见 synthesizeTools
  if (a === 'unknown' || b === 'unknown') return 'unknown'
  return TOOL_RANK[a] >= TOOL_RANK[b] ? a : b
}

export function mergePolicy(base: RoutePolicy, patch: Partial<RoutePolicy>): RoutePolicy {
  return {
    modelTier: patch.modelTier ?? base.modelTier,
    tools: patch.tools ?? base.tools,
    maxSteps: patch.maxSteps ?? base.maxSteps,
    memoryRecall: patch.memoryRecall ?? base.memoryRecall,
    allowSubAgents: patch.allowSubAgents ?? base.allowSubAgents,
    hintUserCreateGroup: patch.hintUserCreateGroup ?? base.hintUserCreateGroup,
    hintUserForge: patch.hintUserForge ?? base.hintUserForge,
  }
}

/**
 * 工具策略合成：
 * - negate 锁定 → none
 * - 任一为 unknown → unknown（交 L2）
 * - 否则在 none|full 间取更开放者
 */
export function synthesizeTools(
  base: ToolPolicy,
  patches: Array<ToolPolicy | undefined>,
  lockNone: boolean,
): ToolPolicy {
  if (lockNone) return 'none'
  const all = [base, ...patches].filter((t): t is ToolPolicy => t != null)
  if (all.some((t) => t === 'unknown')) return 'unknown'
  let t: 'none' | 'full' = base === 'full' ? 'full' : 'none'
  for (const p of all) {
    if (p === 'full') t = 'full'
  }
  return t
}


export function clampScore(score: number): number {
  return clamp(score, 0, 100)
}

export const BAND_INHERIT_SCORE: Record<Exclude<ComplexityBand, 'unknown'>, number> = {
  trivial: 5,
  simple: 15,
  standard: 40,
  complex: 70,
}

export function tierRank(t: ModelTier): number {
  return t === 'weak' ? 0 : t === 'medium' ? 1 : 2
}
