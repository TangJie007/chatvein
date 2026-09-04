import {
  parseRouteDecision,
  type ComplexityBand,
  type ModelTier,
  type RouteDecision,
  type RoutePolicy,
} from '@chatvein/common'
import type { Bm25SearchHit } from './bm25-index'
import {
  BAND_INHERIT_SCORE,
  bandFromScore,
  clampScore,
  DEFAULT_SCORE_TABLE,
  mergePolicy,
  policyForBand,
  synthesizeTools,
  type ScoreTable,
} from './defaults'
import type { HeuristicCtx } from './features'
import type { FiredRuleEvent } from './rules-engine'
import type { RuleEventParams } from './rules'

export interface MaterializeInput {
  ctx: HeuristicCtx
  events: FiredRuleEvent[]
  bm25Hits?: Bm25SearchHit[]
  bm25Vote?: {
    band: Exclude<ComplexityBand, 'unknown'>
    tools: RoutePolicy['tools']
    ratio: number
    adopted: boolean
  } | null
  scoreTable?: ScoreTable
  /** 规则已要求跳过 BM25 时由上层传入；此处再读事件 */
  skipBm25?: boolean
}

interface Acc {
  score: number
  reasons: string[]
  ruleIds: string[]
  bandOverride?: ComplexityBand
  policyPatch: Partial<RoutePolicy>
  terminal?: RouteDecision['terminal']
  confident?: boolean
  skipBm25: boolean
  forbidTrivial: boolean
  forceUnknown: boolean
  /** negate_tools：工具策略锁定为 none，BM25 不可抬升 */
  lockToolsNone: boolean
}

export function materialize(input: MaterializeInput): RouteDecision {
  const table = input.scoreTable ?? DEFAULT_SCORE_TABLE
  const acc: Acc = {
    score: 0,
    reasons: [],
    ruleIds: [],
    policyPatch: {},
    skipBm25: Boolean(input.skipBm25),
    forbidTrivial: false,
    forceUnknown: false,
    lockToolsNone: false,
  }

  for (const ev of input.events) {
    applyEvent(acc, ev.params, input.ctx)
  }

  // forceTier：从 ctx 写入 policy
  if (input.ctx.forceTier) {
    acc.policyPatch.modelTier = input.ctx.forceTier
    acc.reasons.push('force_tier')
  }

  // terminal 短路
  if (acc.terminal) {
    const band = acc.bandOverride ?? 'trivial'
    const policy = mergePolicy(policyForBand(band), acc.policyPatch)
    return parseRouteDecision({
      band,
      confident: acc.confident ?? true,
      policy,
      score: clampScore(acc.score),
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

  let band: ComplexityBand
  let confident: boolean

  if (acc.bandOverride) {
    band = acc.bandOverride
    confident = acc.confident ?? true
  } else {
    const fromScore = bandFromScore(acc.score, table)
    const inGrey = acc.score >= table.greyLow && acc.score <= table.greyHigh
    band = acc.forceUnknown || inGrey ? 'unknown' : fromScore
    confident = acc.confident ?? (!inGrey && !acc.forceUnknown && acc.score > 0)

    // BM25：无硬 band override 时可采纳；tools 与规则合成（unknown 粘性，negate 锁定）
    const vote = input.bm25Vote
    if (vote?.adopted && !acc.bandOverride) {
      band = vote.band
      acc.policyPatch.tools = synthesizeTools(
        acc.policyPatch.tools ?? 'none',
        [vote.tools],
        acc.lockToolsNone,
      )
      confident = true
      acc.reasons.push(`bm25_vote:${vote.band}:${vote.ratio.toFixed(2)}`)
    } else if (vote && !vote.adopted) {
      acc.score = clampScore(acc.score + 5)
      acc.reasons.push('bm25_weak_vote')
      if (!acc.bandOverride) {
        band = bandFromScore(acc.score, table)
      }
    }
  }

  if (acc.forbidTrivial && band === 'trivial') {
    band = 'simple'
    confident = false
  }

  // 无命中信号的短消息：保守 unknown，禁止当 trivial
  if (
    acc.score === 0 &&
    !acc.bandOverride &&
    !input.ctx.hitGreetingOnly &&
    input.ctx.charLen > 0 &&
    input.ctx.charLen < 40 &&
    input.ctx.dictCoverage === 'none'
  ) {
    band = 'unknown'
    confident = false
    acc.reasons.push('no_signal_unsupported_lang')
  }

  if (acc.score === 0 && !acc.bandOverride && band !== 'trivial' && !confident) {
    band = 'unknown'
  }

  // 默认：有 bump 但未 override → 按 score；全无信号走 standard 保守？设计说 unknown 用 medium 保守
  if (acc.score === 0 && !acc.bandOverride && !input.ctx.hitGreetingOnly) {
    band = 'unknown'
    confident = false
    if (!acc.reasons.includes('no_signal_unsupported_lang')) {
      acc.reasons.push('no_strong_signal')
    }
  }

  const policy = mergePolicy(policyForBand(band), acc.policyPatch)

  return parseRouteDecision({
    band,
    confident: Boolean(confident),
    policy,
    score: clampScore(acc.score),
    reasons: acc.reasons,
    ruleIds: acc.ruleIds,
    bm25Hits: input.bm25Hits?.map((h) => ({
      id: h.id,
      score: h.score,
      band: h.band,
      tools: h.tools,
    })),
  })
}

function applyEvent(acc: Acc, params: RuleEventParams, ctx: HeuristicCtx): void {
  const { ruleId, reason } = params
  if (ruleId) acc.ruleIds.push(ruleId)
  if (reason) acc.reasons.push(reason)

  if (params.scoreDelta) acc.score += params.scoreDelta
  if (params.longTextTier) acc.score += longTextDelta(ctx.charLen)
  if (params.inheritLastBand && ctx.lastBand && ctx.lastBand !== 'unknown') {
    acc.score += Math.round(BAND_INHERIT_SCORE[ctx.lastBand] * 0.5)
  }
  if (params.policy) acc.policyPatch = mergePolicyPatch(acc.policyPatch, params.policy)
  if (params.ruleId === 'negate_tools' || params.reason === 'negate_tools') {
    acc.lockToolsNone = true
  }
  if (params.band) acc.bandOverride = params.band
  if (params.terminal) {
    acc.terminal = params.terminal
    if (params.confident !== false) acc.confident = true
  }
  if (params.skipBm25) acc.skipBm25 = true
  if (params.confident === false && !acc.terminal) {
    acc.confident = false
    acc.forceUnknown = true
  } else if (params.confident === true) {
    acc.confident = true
  }
  if (params.forbidTrivial) acc.forbidTrivial = true
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

function longTextDelta(charLen: number): number {
  if (charLen > 2000) return 30
  if (charLen > 800) return 20
  if (charLen > 200) return 10
  return 0
}

export function eventsWantSkipBm25(events: FiredRuleEvent[]): boolean {
  return events.some((e) => e.params.skipBm25)
}
