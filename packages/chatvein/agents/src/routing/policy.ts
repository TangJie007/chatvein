/**
 * band → 默认 RoutePolicy（主要给 L2 merge 用）。
 * L1 短路用 POLICY_SHORT_CIRCUIT（maxSteps=0）；band=trivial 用 POLICY_TRIVIAL_SHORT（4）。
 */
import type { ComplexityBand, ModelTier, RoutePolicy } from '@chatvein/common'

/** L1 寒暄/自我介绍/empty/slash 短路（本地模板，不进 LLM） */
export const POLICY_SHORT_CIRCUIT: RoutePolicy = {
  modelTier: 'weak',
  tools: 'none',
  maxSteps: 0,
  memoryRecall: false,
}

/**
 * L2/`policyForBand('trivial')` 短答预算：仍走主模型友好短答，
 * 与 L1 短路分离，避免 maxSteps=0 → recursionLimit=1 误杀 ReAct。
 */
export const POLICY_TRIVIAL_SHORT: RoutePolicy = {
  modelTier: 'weak',
  tools: 'none',
  maxSteps: 4,
  memoryRecall: false,
}

/** L1 交 L2 时的保守底策（L2 失败 / Passthrough 时仍可用） */
export const POLICY_DEFER_TO_L2: RoutePolicy = {
  modelTier: 'medium',
  tools: 'full',
  maxSteps: 16,
  memoryRecall: true,
}

export function policyForBand(
  band: ComplexityBand,
  extras: Partial<RoutePolicy> = {},
): RoutePolicy {
  return mergePolicy(bandPolicy(band), extras)
}

function bandPolicy(band: ComplexityBand): RoutePolicy {
  switch (band) {
    case 'trivial':
      return POLICY_TRIVIAL_SHORT
    case 'simple':
      return { modelTier: 'weak', tools: 'none', maxSteps: 8, memoryRecall: false }
    case 'standard':
      return { modelTier: 'medium', tools: 'full', maxSteps: 16, memoryRecall: true }
    case 'complex':
      return {
        modelTier: 'strong',
        tools: 'full',
        maxSteps: 64,
        memoryRecall: true,
        allowSubAgents: true,
      }
    case 'unknown':
    default:
      return POLICY_DEFER_TO_L2
  }
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

export function tierRank(t: ModelTier): number {
  return t === 'weak' ? 0 : t === 'medium' ? 1 : 2
}
