import { Engine } from 'json-rules-engine'
import type { HeuristicCtx } from './features'
import { factsFromCtx } from './features'
import type { RuleEventParams } from './rules'
import { createDefaultRules } from './rules'

export interface FiredRuleEvent {
  type: string
  params: RuleEventParams
}

export async function runRulesEngine(
  ctx: HeuristicCtx,
  rules: object[] = createDefaultRules(),
): Promise<FiredRuleEvent[]> {
  const engine = new Engine([], { allowUndefinedFacts: true })
  for (const rule of rules) {
    engine.addRule(rule as never)
  }
  const { events } = await engine.run(factsFromCtx(ctx))
  return events.map((e) => ({
    type: e.type,
    params: (e.params ?? {}) as RuleEventParams,
  }))
}
