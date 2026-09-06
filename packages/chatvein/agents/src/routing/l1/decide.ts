import { parseRouteDecision, type RouteDecision, type RoutePolicy } from '@chatvein/common'
import { mergePolicy, POLICY_DEFER_TO_L2, POLICY_SHORT_CIRCUIT } from '../policy'
import type { HeuristicCtx } from './features'

const MENTION_POLICY: RoutePolicy = {
  modelTier: 'medium',
  tools: 'full',
  maxSteps: 16,
  memoryRecall: true,
}

/**
 * L1 判决：纯函数，无规则引擎。
 * 岔路：terminal / 寒暄短路 / defer_to_l2
 */
export function decideL1(ctx: HeuristicCtx): RouteDecision {
  // 1) terminal
  if (ctx.charLen === 0) {
    return terminalDecision(ctx, 'empty', 'empty_message', 'trivial', POLICY_SHORT_CIRCUIT)
  }
  if (ctx.hasSlashCmd) {
    return terminalDecision(ctx, 'slash', 'slash_command', 'trivial', POLICY_SHORT_CIRCUIT)
  }
  if (ctx.activeMode === 'group' && ctx.hasMention) {
    return terminalDecision(ctx, 'mention', 'group_mention', 'standard', MENTION_POLICY)
  }

  // 2) 寒暄 / 自我介绍短路
  if (ctx.hitGreetingOnly && ctx.charLen <= 30) {
    return shortCircuit(ctx, 'greeting_trivial', 'greeting_only')
  }
  if (ctx.hitSelfIntro && ctx.charLen <= 30) {
    return shortCircuit(ctx, 'self_intro_trivial', 'self_intro')
  }

  // 3) 其余交 L2
  const reasons = ['defer_to_l2']
  if (ctx.dictCoverage === 'none' && ctx.charLen > 0) {
    reasons.unshift('no_signal_unsupported_lang')
  }
  if (ctx.forceTier) reasons.push('force_tier')

  return parseRouteDecision({
    band: 'unknown',
    confident: false,
    policy: withForceTier(POLICY_DEFER_TO_L2, ctx),
    score: 0,
    reasons,
    ruleIds: [],
  })
}

function shortCircuit(
  ctx: HeuristicCtx,
  ruleId: string,
  reason: string,
): RouteDecision {
  const reasons = [reason]
  if (ctx.forceTier) reasons.push('force_tier')
  return parseRouteDecision({
    band: 'trivial',
    confident: true,
    policy: withForceTier(POLICY_SHORT_CIRCUIT, ctx),
    score: 0,
    reasons,
    ruleIds: [ruleId],
  })
}

function terminalDecision(
  ctx: HeuristicCtx,
  kind: 'empty' | 'slash' | 'mention',
  reason: string,
  band: 'trivial' | 'standard',
  base: RoutePolicy,
): RouteDecision {
  const reasons = [reason]
  if (ctx.forceTier) reasons.push('force_tier')
  return parseRouteDecision({
    band,
    confident: true,
    policy: withForceTier(base, ctx),
    score: 0,
    reasons,
    ruleIds: [
      kind === 'empty' ? 'empty' : kind === 'slash' ? 'slash' : 'mention_group',
    ],
    terminal: {
      kind,
      payload: {
        slashCmd: ctx.slashCmd || undefined,
        mentions: ctx.mentions,
      },
    },
  })
}

function withForceTier(base: RoutePolicy, ctx: HeuristicCtx): RoutePolicy {
  if (!ctx.forceTier) return base
  return mergePolicy(base, { modelTier: ctx.forceTier })
}
