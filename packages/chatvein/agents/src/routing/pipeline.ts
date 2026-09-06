/**
 * 路由管线：L1（词典寒暄短路）→ 可选 L2（弱模结构化）→ 预留 L3。
 */
import type { RouteDecision } from '@chatvein/common'
import {
  createL1Router,
  extractFacts,
  L1HeuristicRouter,
  type L1RouterOptions,
  type RouteInput,
} from './l1'
import { createL2Classifier, shouldEscalateToL2, type L2Classifier } from './l2'

export interface HeuristicRouterOptions extends L1RouterOptions {
  l2?: L2Classifier
  enableL2?: boolean
}

/** 对外主入口：L1 → 可选 L2 */
export class HeuristicRouter {
  private readonly l1: L1HeuristicRouter
  private l2: L2Classifier
  private enableL2: boolean

  constructor(options: HeuristicRouterOptions = {}) {
    this.l1 = createL1Router(options)
    this.l2 = options.l2 ?? createL2Classifier()
    this.enableL2 = options.enableL2 !== false
  }

  setL2(l2: L2Classifier, enableL2 = true): void {
    this.l2 = l2
    this.enableL2 = enableL2
  }

  setEnabled(enabled: boolean): void {
    this.l1.setEnabled(enabled)
  }

  async route(input: RouteInput): Promise<RouteDecision> {
    const l1Decision = await this.l1.route(input)
    if (!this.enableL2 || !shouldEscalateToL2(l1Decision)) {
      return l1Decision
    }

    const session = {
      turnIndex: input.session?.turnIndex ?? 0,
      lastBand: input.session?.lastBand,
      lastAssistantHadTools: input.session?.lastAssistantHadTools ?? false,
      recentFailure: input.session?.recentFailure ?? false,
      activeMode: input.session?.activeMode ?? ('chat' as const),
      forceTier: input.session?.forceTier,
    }
    const ctx = extractFacts(input.text, session)
    return this.l2.classify(ctx, l1Decision)
  }
}

let shared: HeuristicRouter | undefined

export function getDefaultHeuristicRouter(): HeuristicRouter {
  if (!shared) shared = new HeuristicRouter()
  return shared
}

export function configureDefaultHeuristicRouter(
  options?: HeuristicRouterOptions,
): HeuristicRouter {
  shared = new HeuristicRouter(options)
  return shared
}

export function createHeuristicRouter(options?: HeuristicRouterOptions): HeuristicRouter {
  return new HeuristicRouter(options)
}

export type { RouteInput }
