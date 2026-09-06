/**
 * band → 默认 RoutePolicy（主要给 L2 merge 用）。
 * L1 只用 SHORT_CIRCUIT / DEFER_TO_L2 两档，见 l1/materialize。
 */
import type { ComplexityBand, ModelTier, RoutePolicy } from '@chatvein/common'

/** L1 寒暄/自我介绍/empty/slash 短路 */
export const POLICY_SHORT_CIRCUIT: RoutePolicy = {
  modelTier: 'weak',
  tools: 'none',
  maxSteps: 0,
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
      return POLICY_SHORT_CIRCUIT
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
