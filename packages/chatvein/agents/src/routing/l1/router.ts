import type { RouteDecision } from '@chatvein/common'
import { decideL1 } from './decide'
import { extractFacts, type HeuristicSession } from './features'

export interface L1RouterOptions {
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
  private enabled: boolean

  constructor(options: L1RouterOptions = {}) {
    this.enabled = options.enabled !== false
  }

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

    return decideL1(extractFacts(input.text, session))
  }
}

export function createL1Router(options?: L1RouterOptions): L1HeuristicRouter {
  return new L1HeuristicRouter(options)
}
