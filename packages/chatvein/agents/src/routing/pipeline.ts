/**
 * 路由管线：L1（启发式）→ 可选 L2（弱模型 stub）→ 预留 L3。
 */
import type { RouteDecision, RoutePrototype } from '@chatvein/common'
import {
  createL1Router,
  extractFacts,
  L1HeuristicRouter,
  type L1RouterOptions,
  type RouteInput,
} from './l1'
import { createL2Classifier, shouldEscalateToL2, type L2Classifier } from './l2'
import { loadDefaultPrototypes } from './locales'

export interface HeuristicRouterOptions extends L1RouterOptions {
  /** 注入 L2；默认 Passthrough stub */
  l2?: L2Classifier
  /** 是否在灰区调用 L2（默认 true；stub 时等价透传） */
  enableL2?: boolean
}

/**
 * 对外主入口（兼容原 HeuristicRouter 名）。
 * 先跑 L1；低置信 / unknown 且非 terminal 时再走 L2。
 */
export class HeuristicRouter {
  private readonly l1: L1HeuristicRouter
  private readonly l2: L2Classifier
  private readonly enableL2: boolean

  constructor(options: HeuristicRouterOptions = {}) {
    this.l1 = createL1Router(options)
    this.l2 = options.l2 ?? createL2Classifier()
    this.enableL2 = options.enableL2 !== false
  }

  reloadRules(rules: object[]): void {
    this.l1.reloadRules(rules)
  }

  reloadPrototypes(prototypes: RoutePrototype[]): void {
    this.l1.reloadPrototypes(prototypes)
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
      activeMode: input.session?.activeMode ?? 'chat' as const,
      forceTier: input.session?.forceTier,
    }
    const ctx = extractFacts(input.text, session)
    const l2Decision = await this.l2.classify(ctx, l1Decision)
    if (l2Decision === l1Decision) return l1Decision
    return {
      ...l2Decision,
      reasons: [...l2Decision.reasons, 'l2_classifier'],
    }
  }
}

let shared: HeuristicRouter | undefined

export function getDefaultHeuristicRouter(): HeuristicRouter {
  if (!shared) shared = new HeuristicRouter()
  return shared
}

export function createHeuristicRouter(options?: HeuristicRouterOptions): HeuristicRouter {
  return new HeuristicRouter(options)
}

export type { RouteInput }
export { loadDefaultPrototypes }
