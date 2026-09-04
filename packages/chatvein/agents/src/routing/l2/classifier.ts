/**
 * L2：弱模型复杂度分类（灰区 / unknown）。
 * 一期仅 stub：原样返回 L1 决策，不调模型。
 */
import type { RouteDecision } from '@chatvein/common'
import type { HeuristicCtx } from '../l1/features'

export interface L2Classifier {
  classify(ctx: HeuristicCtx, l1: RouteDecision): Promise<RouteDecision>
}

/** 未实现的弱模型分类器：透传 L1 */
export class PassthroughL2Classifier implements L2Classifier {
  async classify(_ctx: HeuristicCtx, l1: RouteDecision): Promise<RouteDecision> {
    return l1
  }
}

export function createL2Classifier(): L2Classifier {
  return new PassthroughL2Classifier()
}

/** 是否应进入 L2：低置信或 unknown，且非 terminal */
export function shouldEscalateToL2(decision: RouteDecision): boolean {
  if (decision.terminal) return false
  return !decision.confident || decision.band === 'unknown'
}
