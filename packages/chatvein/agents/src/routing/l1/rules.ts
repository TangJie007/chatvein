import type { ComplexityBand, RoutePolicy, RouteTerminal } from '@chatvein/common'

/** json-rules-engine ?? params */
export interface RuleEventParams {
  ruleId: string
  reason: string
  band?: ComplexityBand
  policy?: Partial<RoutePolicy>
  terminal?: RouteTerminal
  confident?: boolean
}

export type RuleEventType = 'route.terminal' | 'route.override'

/** L1 ??terminal + ??/?????????? L2 */
export function createDefaultRules(): object[] {
  return [
    {
      name: 'empty',
      priority: 1000,
      conditions: { all: [{ fact: 'charLen', operator: 'equal', value: 0 }] },
      event: {
        type: 'route.terminal',
        params: {
          ruleId: 'empty',
          reason: 'empty_message',
          terminal: { kind: 'empty' },
          confident: true,
          band: 'trivial',
          policy: { modelTier: 'weak', tools: 'none', maxSteps: 0, memoryRecall: false },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'slash',
      priority: 990,
      conditions: { all: [{ fact: 'hasSlashCmd', operator: 'equal', value: true }] },
      event: {
        type: 'route.terminal',
        params: {
          ruleId: 'slash',
          reason: 'slash_command',
          terminal: { kind: 'slash' },
          confident: true,
          band: 'trivial',
          policy: { modelTier: 'weak', tools: 'none', maxSteps: 0, memoryRecall: false },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'mention_group',
      priority: 980,
      conditions: {
        all: [
          { fact: 'activeMode', operator: 'equal', value: 'group' },
          { fact: 'hasMention', operator: 'equal', value: true },
        ],
      },
      event: {
        type: 'route.terminal',
        params: {
          ruleId: 'mention_group',
          reason: 'group_mention',
          terminal: { kind: 'mention' },
          confident: true,
          band: 'standard',
          policy: { modelTier: 'medium', tools: 'full', maxSteps: 16, memoryRecall: true },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'force_tier',
      priority: 900,
      conditions: { all: [{ fact: 'hasForceTier', operator: 'equal', value: true }] },
      event: {
        type: 'route.override',
        params: {
          ruleId: 'force_tier',
          reason: 'user_force_tier',
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'greeting_trivial',
      priority: 800,
      conditions: {
        all: [
          { fact: 'hitGreetingOnly', operator: 'equal', value: true },
          { fact: 'charLen', operator: 'lessThanInclusive', value: 30 },
        ],
      },
      event: {
        type: 'route.override',
        params: {
          ruleId: 'greeting_trivial',
          reason: 'greeting_only',
          band: 'trivial',
          confident: true,
          policy: { modelTier: 'weak', tools: 'none', maxSteps: 0, memoryRecall: false },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'self_intro_trivial',
      priority: 795,
      conditions: {
        all: [
          { fact: 'hitSelfIntro', operator: 'equal', value: true },
          { fact: 'charLen', operator: 'lessThanInclusive', value: 30 },
        ],
      },
      event: {
        type: 'route.override',
        params: {
          ruleId: 'self_intro_trivial',
          reason: 'self_intro',
          band: 'trivial',
          confident: true,
          policy: { modelTier: 'weak', tools: 'none', maxSteps: 0, memoryRecall: false },
        } satisfies RuleEventParams,
      },
    },
  ]
}
