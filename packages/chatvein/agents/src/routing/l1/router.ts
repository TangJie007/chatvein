import type { RouteDecision, RoutePrototype } from '@chatvein/common'
import { loadDefaultPrototypes } from '../locales'
import { RouteBm25Index, type Bm25IndexOptions } from './bm25-index'
import { DEFAULT_SCORE_TABLE, type ScoreTable } from './defaults'
import { extractFacts, type HeuristicSession } from './features'
import { eventsWantSkipBm25, materialize } from './materialize'
import { createDefaultRules } from './rules'
import { runRulesEngine } from './rules-engine'

export interface L1RouterOptions {
  rules?: object[]
  prototypes?: RoutePrototype[]
  scoreTable?: ScoreTable
  bm25?: Bm25IndexOptions
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

/** L1：启发式规则 + BM25 先例（无 LLM） */
export class L1HeuristicRouter {
  private rules: object[]
  private readonly scoreTable: ScoreTable
  private readonly bm25: RouteBm25Index
  private enabled: boolean

  constructor(options: L1RouterOptions = {}) {
    this.rules = options.rules ?? createDefaultRules()
    this.scoreTable = options.scoreTable ?? DEFAULT_SCORE_TABLE
    this.bm25 = new RouteBm25Index(options.bm25)
    this.bm25.reload(options.prototypes ?? loadDefaultPrototypes())
    this.enabled = options.enabled !== false
  }

  reloadRules(rules: object[]): void {
    this.rules = rules
  }

  reloadPrototypes(prototypes: RoutePrototype[]): void {
    this.bm25.reload(prototypes)
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

    const ctx = extractFacts(input.text, session)
    const events = await runRulesEngine(ctx, this.rules)
    const skipBm25 = eventsWantSkipBm25(events)

    let bm25Hits
    let bm25Vote = null
    if (!skipBm25) {
      const provisionalConfident = events.some((e) => e.params.confident === true)
      if (!provisionalConfident) {
        const langFilter = ctx.lang === 'zh' ? 'zh' : undefined
        bm25Hits = this.bm25.search(ctx.text, langFilter)
        bm25Vote = this.bm25.vote(bm25Hits)
      }
    }

    return materialize({
      ctx,
      events,
      bm25Hits,
      bm25Vote,
      scoreTable: this.scoreTable,
      skipBm25,
    })
  }
}

/** @deprecated 使用 L1HeuristicRouter */
export class HeuristicRouter extends L1HeuristicRouter {}

export function createL1Router(options?: L1RouterOptions): L1HeuristicRouter {
  return new L1HeuristicRouter(options)
}

/** @deprecated 使用 createL1Router / pipeline.createHeuristicRouter */
export function createHeuristicRouter(options?: L1RouterOptions): L1HeuristicRouter {
  return createL1Router(options)
}
