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

const TOOL_RANK: Record<ToolPolicy, number> = { none: 0, read_only: 1, full: 2 }

export function maxToolPolicy(a: ToolPolicy, b: ToolPolicy): ToolPolicy {
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

/** 工具策略合成：抬升用 max；若出现 none 锁定（否定工具）则封顶为 none */
export function synthesizeTools(
  base: ToolPolicy,
  patches: Array<ToolPolicy | undefined>,
  lockNone: boolean,
): ToolPolicy {
  if (lockNone) return 'none'
  let t = base
  for (const p of patches) {
    if (p) t = maxToolPolicy(t, p)
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
