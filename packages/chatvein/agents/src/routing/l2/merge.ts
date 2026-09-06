/**
 * 将 L2 判定合并进 L1 RouteDecision。
 */
import type { RouteDecision, RoutePolicy } from '@chatvein/common'
import { parseRouteDecision } from '@chatvein/common'
import { mergePolicy, policyForBand } from '../policy'
import type { L2Judgement } from './schema'

export function mergeL2Judgement(l1: RouteDecision, judgement: L2Judgement): RouteDecision {
  if (l1.terminal) return l1

  const base = policyForBand(judgement.band)
  const patch: Partial<RoutePolicy> = {
    tools: judgement.tools,
    modelTier: judgement.modelTier,
    maxSteps: judgement.maxSteps,
    memoryRecall: judgement.memoryRecall,
    allowSubAgents: judgement.allowSubAgents,
    hintUserCreateGroup: judgement.hintUserCreateGroup ?? l1.policy.hintUserCreateGroup,
    hintUserForge: judgement.hintUserForge ?? l1.policy.hintUserForge,
  }
  const policy = mergePolicy(base, patch)

  if (policy.tools === 'unknown') {
    policy.tools = judgement.tools === 'none' ? 'none' : 'full'
  }

  const reasons = [...l1.reasons, 'l2_classifier']
  if (judgement.reason?.trim()) {
    reasons.push(`l2:${judgement.reason.trim().slice(0, 80)}`)
  }
  if (!judgement.confident) {
    reasons.push('l2_low_confidence')
  }

  const rewritten = judgement.rewrittenQuery.trim()
  return parseRouteDecision({
    band: judgement.band,
    confident: judgement.confident,
    policy,
    score: l1.score,
    reasons,
    ruleIds: [...l1.ruleIds, 'l2'],
    rewrittenQuery: rewritten || undefined,
    terminal: l1.terminal,
  })
}
