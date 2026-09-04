import type { ComplexityBand, RoutePolicy, RouteTerminal } from '@chatvein/common'

/** json-rules-engine 事件 params */
export interface RuleEventParams {
  ruleId: string
  reason: string
  scoreDelta?: number
  band?: ComplexityBand
  policy?: Partial<RoutePolicy>
  terminal?: RouteTerminal
  skipBm25?: boolean
  confident?: boolean
  /** inherit_last：按 lastBand 加分 */
  inheritLastBand?: boolean
  /** 长文分段加分由 charLen 规则用 scoreDelta；此标记供 materialize 再算 */
  longTextTier?: boolean
  forbidTrivial?: boolean
}

export type RuleEventType = 'route.terminal' | 'route.override' | 'route.bump' | 'route.tag'

/** 默认 P0 规则表（可被外部 JSON 覆盖） */
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
          skipBm25: true,
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
          skipBm25: true,
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
          skipBm25: true,
          band: 'standard',
          policy: { modelTier: 'medium', tools: 'full', maxSteps: 8, memoryRecall: true },
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
          { fact: 'hitTaskVerb', operator: 'equal', value: false },
          { fact: 'hitToolVerb', operator: 'equal', value: false },
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
          skipBm25: true,
          policy: { modelTier: 'weak', tools: 'none', maxSteps: 0, memoryRecall: false },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'negate_tools',
      priority: 700,
      conditions: { all: [{ fact: 'hitNegateTool', operator: 'equal', value: true }] },
      event: {
        type: 'route.override',
        params: {
          ruleId: 'negate_tools',
          reason: 'negate_tools',
          policy: { tools: 'none' },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'code_fence',
      priority: 600,
      conditions: { all: [{ fact: 'hasCodeFence', operator: 'equal', value: true }] },
      event: {
        type: 'route.bump',
        params: { ruleId: 'code_fence', reason: 'code_fence', scoreDelta: 25 } satisfies RuleEventParams,
      },
    },
    {
      name: 'path_like',
      priority: 590,
      conditions: { all: [{ fact: 'hasPathLike', operator: 'equal', value: true }] },
      event: {
        type: 'route.bump',
        params: { ruleId: 'path_like', reason: 'path_like', scoreDelta: 20 } satisfies RuleEventParams,
      },
    },
    {
      name: 'tool_verb',
      priority: 580,
      conditions: {
        all: [
          { fact: 'hitToolVerb', operator: 'equal', value: true },
          { fact: 'hitNegateTool', operator: 'equal', value: false },
        ],
      },
      event: {
        type: 'route.bump',
        params: {
          ruleId: 'tool_verb',
          reason: 'tool_verb',
          scoreDelta: 20,
          policy: { tools: 'unknown' },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'task_verb',
      priority: 570,
      conditions: { all: [{ fact: 'hitTaskVerb', operator: 'equal', value: true }] },
      event: {
        type: 'route.bump',
        params: { ruleId: 'task_verb', reason: 'task_verb', scoreDelta: 15 } satisfies RuleEventParams,
      },
    },
    {
      name: 'multi_step',
      priority: 560,
      conditions: {
        any: [
          { fact: 'hitMultiStep', operator: 'equal', value: true },
          { fact: 'listItemCount', operator: 'greaterThanInclusive', value: 3 },
        ],
      },
      event: {
        type: 'route.bump',
        params: { ruleId: 'multi_step', reason: 'multi_step', scoreDelta: 15 } satisfies RuleEventParams,
      },
    },
    {
      name: 'compare',
      priority: 550,
      conditions: { all: [{ fact: 'hitCompare', operator: 'equal', value: true }] },
      event: {
        type: 'route.bump',
        params: {
          ruleId: 'compare',
          reason: 'compare',
          scoreDelta: 20,
          policy: { allowSubAgents: true },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'multi_agent_need',
      priority: 545,
      conditions: { all: [{ fact: 'hitMultiAgentNeed', operator: 'equal', value: true }] },
      event: {
        type: 'route.bump',
        params: {
          ruleId: 'multi_agent_need',
          reason: 'multi_agent_need',
          scoreDelta: 15,
          policy: { allowSubAgents: true },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'group_intent',
      priority: 540,
      conditions: { all: [{ fact: 'hitGroupIntent', operator: 'equal', value: true }] },
      event: {
        type: 'route.tag',
        params: {
          ruleId: 'group_intent',
          reason: 'hint_user_create_group',
          policy: { hintUserCreateGroup: true },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'forge_intent',
      priority: 530,
      conditions: { all: [{ fact: 'hitForgeIntent', operator: 'equal', value: true }] },
      event: {
        type: 'route.bump',
        params: {
          ruleId: 'forge_intent',
          reason: 'hint_user_forge',
          scoreDelta: 25,
          policy: { hintUserForge: true },
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'correction',
      priority: 520,
      conditions: {
        any: [
          { fact: 'hitCorrection', operator: 'equal', value: true },
          { fact: 'recentFailure', operator: 'equal', value: true },
        ],
      },
      event: {
        type: 'route.bump',
        params: {
          ruleId: 'correction',
          reason: 'correction',
          scoreDelta: 25,
          forbidTrivial: true,
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'long_text',
      priority: 510,
      conditions: { all: [{ fact: 'charLen', operator: 'greaterThan', value: 200 }] },
      event: {
        type: 'route.bump',
        params: {
          ruleId: 'long_text',
          reason: 'long_text',
          longTextTier: true,
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'inherit_last',
      priority: 400,
      conditions: {
        all: [
          { fact: 'turnIndex', operator: 'greaterThan', value: 0 },
          { fact: 'hitCorrection', operator: 'equal', value: false },
          { fact: 'charLen', operator: 'lessThan', value: 20 },
          { fact: 'hasLastBand', operator: 'equal', value: true },
        ],
      },
      event: {
        type: 'route.bump',
        params: {
          ruleId: 'inherit_last',
          reason: 'inherit_last_band',
          inheritLastBand: true,
        } satisfies RuleEventParams,
      },
    },
    {
      name: 'dict_none_guard',
      priority: 300,
      conditions: {
        all: [
          { fact: 'dictCoverage', operator: 'equal', value: 'none' },
          { fact: 'charLen', operator: 'greaterThan', value: 0 },
          { fact: 'hasCodeFence', operator: 'equal', value: false },
          { fact: 'hasPathLike', operator: 'equal', value: false },
          { fact: 'charLen', operator: 'lessThan', value: 40 },
        ],
      },
      event: {
        type: 'route.tag',
        params: {
          ruleId: 'dict_none_guard',
          reason: 'unsupported_lang_conservative',
          confident: false,
        } satisfies RuleEventParams,
      },
    },
  ]
}
