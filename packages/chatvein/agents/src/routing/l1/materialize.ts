import {
  parseRouteDecision,
  type ComplexityBand,
  type ModelTier,
  type RouteDecision,
  type RoutePolicy,
} from '@chatvein/common'
import { mergePolicy, POLICY_DEFER_TO_L2, POLICY_SHORT_CIRCUIT } from '../policy'
import type { HeuristicCtx } from './features'
import type { FiredRuleEvent } from './rules-engine'
import type { RuleEventParams } from './rules'

export interface MaterializeInput {
  ctx: HeuristicCtx
  events: FiredRuleEvent[]
}

interface Acc {
  reasons: string[]
  ruleIds: string[]
  bandOverride?: ComplexityBand
  policyPatch: Partial<RoutePolicy>
  terminal?: RouteDecision['terminal']
  confident?: boolean
}

/**
 * L1 只有两岔：
 * 1) terminal / 寒暄短路 → SHORT_CIRCUIT（规则 patch 可覆盖，如 mention→standard）
 * 2) 其余 → DEFER_TO_L2（band=unknown，交 L2）
 */
export function materialize(input: MaterializeInput): RouteDecision {
  const acc: Acc = {
    reasons: [],
    ruleIds: [],
    policyPatch: {},
  }

  for (const ev of input.events) {
    applyEvent(acc, ev.params)
  }

  if (input.ctx.forceTier) {
    acc.policyPatch.modelTier = input.ctx.forceTier
    acc.reasons.push('force_tier')
  }

  if (acc.terminal) {
    const band = acc.bandOverride ?? 'trivial'
    // mention 等规则已在 patch 里带全量 policy；底策仅补缺省
    const base = band === 'trivial' ? POLICY_SHORT_CIRCUIT : POLICY_DEFER_TO_L2
    return parseRouteDecision({
      band,
      confident: acc.confident ?? true,
      policy: mergePolicy(base, acc.policyPatch),
      score: 0,
      reasons: acc.reasons,
      ruleIds: acc.ruleIds,
      terminal: {
        ...acc.terminal,
        payload: {
          ...(acc.terminal.payload ?? {}),
          slashCmd: input.ctx.slashCmd || undefined,
          mentions: input.ctx.mentions,
        },
      },
    })
  }

  if (isGreetingShortCircuit(acc)) {
    return parseRouteDecision({
      band: 'trivial',
      confident: true,
      policy: mergePolicy(POLICY_SHORT_CIRCUIT, acc.policyPatch),
      score: 0,
      reasons: acc.reasons,
      ruleIds: acc.ruleIds,
    })
  }

  if (input.ctx.dictCoverage === 'none' && input.ctx.charLen > 0) {
    acc.reasons.push('no_signal_unsupported_lang')
  }
  if (!acc.reasons.includes('defer_to_l2')) {
    acc.reasons.push('defer_to_l2')
  }

  return parseRouteDecision({
    band: 'unknown',
    confident: false,
    policy: mergePolicy(POLICY_DEFER_TO_L2, acc.policyPatch),
    score: 0,
    reasons: acc.reasons,
    ruleIds: acc.ruleIds,
  })
}

function isGreetingShortCircuit(acc: Acc): boolean {
  if (acc.confident !== true || acc.bandOverride !== 'trivial') return false
  return (
    acc.ruleIds.includes('greeting_trivial') || acc.ruleIds.includes('self_intro_trivial')
  )
}

function applyEvent(acc: Acc, params: RuleEventParams): void {
  if (params.ruleId) acc.ruleIds.push(params.ruleId)
  if (params.reason) acc.reasons.push(params.reason)
  if (params.policy) acc.policyPatch = mergePolicyPatch(acc.policyPatch, params.policy)
  if (params.band) acc.bandOverride = params.band
  if (params.terminal) {
    acc.terminal = params.terminal
    if (params.confident !== false) acc.confident = true
  }
  if (params.confident === true) acc.confident = true
  if (params.confident === false && !acc.terminal) acc.confident = false
}

function mergePolicyPatch(
  a: Partial<RoutePolicy>,
  b: Partial<RoutePolicy>,
): Partial<RoutePolicy> {
  return {
    ...a,
    ...b,
    tools: b.tools ?? a.tools,
    modelTier: (b.modelTier as ModelTier | undefined) ?? a.modelTier,
    allowSubAgents: b.allowSubAgents ?? a.allowSubAgents,
    hintUserCreateGroup: b.hintUserCreateGroup ?? a.hintUserCreateGroup,
    hintUserForge: b.hintUserForge ?? a.hintUserForge,
    maxSteps: b.maxSteps ?? a.maxSteps,
    memoryRecall: b.memoryRecall ?? a.memoryRecall,
  }
}
