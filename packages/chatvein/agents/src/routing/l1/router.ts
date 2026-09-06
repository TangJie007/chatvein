import type { RouteDecision, RoutePrototype } from '@chatvein/common'
import { extractFacts, type HeuristicSession } from './features'
import { materialize } from './materialize'
import { createDefaultRules } from './rules'
import { runRulesEngine } from './rules-engine'

export interface L1RouterOptions {
  rules?: object[]
  /** @deprecated 已移除 */
  prototypes?: RoutePrototype[]
  enabled?: boolean
}

export interface RouteInput {
  text: string
  session?: Partial<HeuristicSession>
}

const CONSERVATIVE: RouteDecision = {
  band: 'unknown',
  confident: false,
  policy: {
    modelTier: 'medium',
    tools: 'full',
    maxSteps: 16,
    memoryRecall: true,
  },
  score: 0,
  reasons: ['router_disabled'],
  ruleIds: [],
}

/** L1：词典寒暄/自我介绍短路；其余 defer_to_l2 */
export class L1HeuristicRouter {
  private rules: object[]
  private enabled: boolean

  constructor(options: L1RouterOptions = {}) {
    this.rules = options.rules ?? createDefaultRules()
    this.enabled = options.enabled !== false
  }

  reloadRules(rules: object[]): void {
    this.rules = rules
  }

  /** @deprecated */
  reloadPrototypes(_prototypes: RoutePrototype[]): void {}

  setEnabled(enabled: boolean): void {
    this.enabled = enabled
  }

  async route(input: RouteInput): Promise<RouteDecision> {
    if (!this.enabled) return { ...CONSERVATIVE }

    const session: HeuristicSession = {
      turnIndex: input.session?.turnIndex ?? 0,
      lastBand: input.session?.lastBand,
      lastAssistantHadTools: input.session?.lastAssistantHadTools ?? false,
      recentFailure: input.session?.recentFailure ?? false,
      activeMode: input.session?.activeMode ?? 'chat',
      forceTier: input.session?.forceTier,
    }

    const ctx = extractFacts(input.text, session)
    const events = await runRulesEngine(ctx, this.rules)
    return materialize({ ctx, events })
  }
}

/** @deprecated 使用 L1HeuristicRouter */
export class HeuristicRouter extends L1HeuristicRouter {}

export function createL1Router(options?: L1RouterOptions): L1HeuristicRouter {
  return new L1HeuristicRouter(options)
}

/** @deprecated */
export function createHeuristicRouter(options?: L1RouterOptions): L1HeuristicRouter {
  return createL1Router(options)
}
