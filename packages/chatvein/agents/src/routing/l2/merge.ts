/**
 * 将 L2 判定合并进 L1 RouteDecision。
 * - L2 负责消化 band/tools 的 unknown
 * - L1 的 terminal 不得被 L2 改写
 * - hint*：L2 显式给出则覆盖，否则保留 L1
 */
import type { RouteDecision, RoutePolicy } from '@chatvein/common'
import { parseRouteDecision } from '@chatvein/common'
import { mergePolicy, policyForBand } from '../l1/defaults'
import type { L2Judgement } from './schema'

export function mergeL2Judgement(l1: RouteDecision, judgement: L2Judgement): RouteDecision {
  // terminal 硬短路不应进入 L2；防守性原样返回
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

  // L2 后禁止残留 unknown（schema 已约束；此处双保险）
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

  return parseRouteDecision({
    band: judgement.band,
    confident: judgement.confident,
    policy,
    score: l1.score,
    reasons,
    ruleIds: [...l1.ruleIds, 'l2'],
    bm25Hits: l1.bm25Hits,
    terminal: l1.terminal,
  })
}
