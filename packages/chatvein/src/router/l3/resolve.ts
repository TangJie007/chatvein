/**
 * L3 收口（纯函数，无模型）：把 L3 重判结果按 §8 / §9 转成最终可采纳决策。
 *
 * 参考设计：docs/分层路由与预算决策.md
 * - §8  升级后仍低置信：缺关键信息 → clarification；否则抬一档采纳
 * - §9  澄清占位：lane=direct / domain=general / confidence 偏低
 *
 * 本模块只做形态推导，不跑模型；供编排层（createRouterAgent）在 L3 之后调用。
 */
import { DEFAULT_BAND } from '../constants'
import type { Band, Lane } from '../types'
import type { L3Decision, L3Thresholds } from './types'

const LANE_ORDER: Lane[] = ['direct', 'agentic', 'orchestrated']
const BAND_ORDER: Band[] = ['trivial', 'simple', 'standard', 'complex']

export function liftLane(lane: Lane): Lane {
  const i = LANE_ORDER.indexOf(lane)
  return LANE_ORDER[Math.min(i + 1, LANE_ORDER.length - 1)]
}

export function liftBand(band: Band): Band {
  const i = BAND_ORDER.indexOf(band)
  return BAND_ORDER[Math.min(i + 1, BAND_ORDER.length - 1)]
}

export type L3Resolution =
  | { kind: 'adopt'; decision: L3Decision }
  | { kind: 'clarify'; decision: L3Decision }
  | { kind: 'lift'; decision: L3Decision }

function liftDecision(decision: L3Decision): L3Decision {
  const lane = liftLane(decision.lane)
  // 抬档：lane 升一档，band 至少不低于该 lane 的默认档
  const floor = DEFAULT_BAND[lane]
  const floorIdx = BAND_ORDER.indexOf(floor)
  const bandIdx = BAND_ORDER.indexOf(liftBand(decision.band))
  const band = BAND_ORDER[Math.max(floorIdx, bandIdx)]
  return {
    ...decision,
    lane,
    band,
    ambiguous: true,
    reason: `${decision.reason}；L3 仍低置信，抬一档采纳（${decision.lane}→${lane}）`,
  }
}

/**
 * L3 收口。
 * - 携带 clarification → clarify（反问，用模型给的候选）
 * - confidence ≥ escalate → adopt（0.6~0.85 之间标 ambiguous，不额外抬档）
 * - 仍 < escalate → lift（缺关键信息时强模应已给 clarification，走到这里即抬一档）
 */
export function resolveL3(
  decision: L3Decision,
  thresholds: L3Thresholds = {},
): L3Resolution {
  const escalate = thresholds.escalate ?? 0.6

  if (decision.clarification) {
    return { kind: 'clarify', decision }
  }
  if (decision.confidence < escalate) {
    return { kind: 'lift', decision: liftDecision(decision) }
  }

  // §8：escalate~accept 采纳但标 ambiguous；direct + 非 general 抬到 agentic
  const accept = thresholds.accept ?? 0.85
  if (decision.confidence < accept) {
    const grey: L3Decision = { ...decision, ambiguous: true }
    if (grey.lane === 'direct' && grey.domain !== 'general') {
      return {
        kind: 'adopt',
        decision: { ...grey, lane: 'agentic', reason: `${grey.reason}；direct 灰区抬 agentic` },
      }
    }
    return { kind: 'adopt', decision: grey }
  }
  return { kind: 'adopt', decision }
}
