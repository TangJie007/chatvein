/**
 * createRouterAgent — L0 → L1 → L2 →（条件）L3 编排。
 *
 * 输出 `RouterDecision`（lane × domain × band + budget），无旧 target 兼容层。
 * @see docs/分层路由与预算决策.md §4–§5 / §17
 */
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { LRUCache } from 'lru-cache'
import { deriveBudget, type BudgetPolicy, type BudgetSpec } from './l0/budget'
import {
  createRouteCache,
  runL0,
  type RouteCore,
} from './l0'
import { extractFacts, runL1, type EmbedPort, type PrototypeSearchPort } from './l1'
import { classifyL2, L2_PROMPT_VERSION } from './l2'
import {
  classifyL3,
  L3_DEFAULT_ESCALATE,
  L3_PROMPT_VERSION,
  liftBand,
  liftLane,
  resolveL3,
  type L3Prior,
} from './l3'
import type {
  Band,
  Domain,
  Lane,
  SafetyResult,
  SafetyRule,
} from './types'

export type RouterDecidedBy =
  | 'cache'
  | 'rule'
  | 'semantic'
  | 'l2'
  | 'l3'
  | 'fallback'

export interface RouterDecision {
  lane: Lane
  domain: Domain
  band: Band
  budget: BudgetSpec
  confidence: number
  ambiguous: boolean
  decidedBy: RouterDecidedBy
  clarification?: { question: string; options?: string[] }
  safety: SafetyResult
  query: {
    rewritten: string
    searchQuery?: string
    slots?: Record<string, unknown>
    intents?: string[]
  }
  reason: string
  meta: {
    latencyMs: number
    layerPath: string[]
    promptVersion: string
  }
}

export interface RouterInput {
  text: string
  history?: Array<{ role: string; content: string }>
  attachments?: Array<{ name: string; mime?: string }>
  lockLane?: Lane
  lockDomain?: Domain
  signal?: AbortSignal
}

export interface CreateRouterAgentOptions {
  /** L2 弱模型；省略则 L2 不可用，走 L1 或 fallback */
  fastModel?: LanguageModelLike
  /** L3 强模型；省略则不升级 */
  strongModel?: LanguageModelLike
  /** L1 语义：向量表检索（生产） */
  search?: PrototypeSearchPort
  /** L1 语义：内存 embed（测试/降级） */
  embed?: EmbedPort
  /** 进程内路由缓存；`false` 关闭；默认小 LRU */
  cache?: LRUCache<string, RouteCore> | false
  safetyRules?: SafetyRule[]
  thresholds?: { accept?: number; escalate?: number }
  budgetPolicy?: BudgetPolicy
  timeoutMs?: { l2?: number; l3?: number }
  promptVersion?: string
  hooks?: { onDecision?: (d: RouterDecision, input: RouterInput) => void }
}

export interface RouterAgent {
  route(input: RouterInput): Promise<RouterDecision>
}

interface PartialCore {
  lane: Lane
  domain: Domain
  band: Band
  confidence: number
  ambiguous: boolean
  decidedBy: RouterDecidedBy
  query: RouterDecision['query']
  reason: string
  clarification?: RouterDecision['clarification']
}

function fallbackCore(text: string, reason: string): PartialCore {
  const t = text.trim()
  return {
    lane: 'direct',
    domain: 'general',
    band: 'trivial',
    confidence: 0,
    ambiguous: true,
    decidedBy: 'fallback',
    query: { rewritten: t, searchQuery: t || undefined },
    reason,
  }
}

function fromRouteCore(core: RouteCore, decidedBy: 'cache' | 'rule'): PartialCore {
  return {
    lane: core.lane,
    domain: core.domain,
    band: core.band,
    confidence: core.confidence,
    ambiguous: core.confidence < 0.85,
    decidedBy,
    query: { ...core.query },
    reason: core.reason,
  }
}

function needsL3(
  prior: Pick<PartialCore, 'confidence' | 'ambiguous' | 'query'>,
  safety: SafetyResult,
  escalate: number,
): boolean {
  if (safety.verdict === 'review') return true
  if (prior.ambiguous) return true
  if (prior.confidence < escalate) return true
  const intents = prior.query.intents
  return Boolean(intents && intents.length > 1)
}

function toL3Prior(p: PartialCore): L3Prior {
  return {
    decidedBy: p.decidedBy,
    lane: p.lane,
    domain: p.domain,
    band: p.band,
    confidence: p.confidence,
    ambiguous: p.ambiguous,
    reason: p.reason,
    intents: p.query.intents,
    clarification: p.clarification,
  }
}

function assemble(
  partial: PartialCore,
  safety: SafetyResult,
  layerPath: string[],
  startedAt: number,
  options: CreateRouterAgentOptions,
): RouterDecision {
  return {
    lane: partial.lane,
    domain: partial.domain,
    band: partial.band,
    budget: deriveBudget(partial.band, options.budgetPolicy),
    confidence: partial.confidence,
    ambiguous: partial.ambiguous,
    decidedBy: partial.decidedBy,
    clarification: partial.clarification,
    safety,
    query: partial.query,
    reason: partial.reason,
    meta: {
      latencyMs: Math.max(0, Date.now() - startedAt),
      layerPath,
      promptVersion:
        options.promptVersion ?? `${L2_PROMPT_VERSION}/${L3_PROMPT_VERSION}`,
    },
  }
}

function toCacheCore(p: PartialCore): RouteCore {
  return {
    lane: p.lane,
    domain: p.domain,
    band: p.band,
    confidence: p.confidence,
    query: { ...p.query },
    reason: p.reason,
  }
}

async function maybeUpgradeL3(
  partial: PartialCore,
  args: {
    text: string
    history?: RouterInput['history']
    attachments?: RouterInput['attachments']
    facts?: ReturnType<typeof extractFacts>
    safety: SafetyResult
    strongModel: LanguageModelLike
    timeoutMs?: number
    signal?: AbortSignal
    accept: number
    escalate: number
    layerPath: string[]
  },
): Promise<PartialCore> {
  if (!needsL3(partial, args.safety, args.escalate)) return partial
  args.layerPath.push('l3')
  const l3 = await classifyL3(
    {
      text: args.text,
      history: args.history,
      attachments: args.attachments,
      facts: args.facts,
      prior: toL3Prior(partial),
      safety: args.safety,
    },
    {
      model: args.strongModel,
      timeoutMs: args.timeoutMs,
      signal: args.signal,
    },
  )
  if (l3.kind === 'decide') {
    const resolved = resolveL3(l3, {
      accept: args.accept,
      escalate: args.escalate,
    })
    return {
      lane: resolved.decision.lane,
      domain: resolved.decision.domain,
      band: resolved.decision.band,
      confidence: resolved.decision.confidence,
      ambiguous: resolved.decision.ambiguous,
      decidedBy: 'l3',
      query: { ...resolved.decision.query },
      reason: resolved.decision.reason,
      clarification: resolved.decision.clarification,
    }
  }
  const lane = liftLane(partial.lane)
  return {
    ...partial,
    lane,
    band: liftBand(partial.band),
    ambiguous: true,
    reason: `${partial.reason}；L3 不可用（${l3.reason}），抬档采纳`,
  }
}

export function createRouterAgent(
  options: CreateRouterAgentOptions = {},
): RouterAgent {
  const cache =
    options.cache === false
      ? undefined
      : (options.cache ?? createRouteCache())
  const accept = options.thresholds?.accept ?? 0.85
  const escalate = options.thresholds?.escalate ?? L3_DEFAULT_ESCALATE

  return {
    async route(input: RouterInput): Promise<RouterDecision> {
      const startedAt = Date.now()
      const layerPath: string[] = ['l0']
      const rawText = input.text ?? ''

      const l0 = runL0(
        {
          text: rawText,
          history: input.history,
          attachments: input.attachments,
          lockLane: input.lockLane,
          lockDomain: input.lockDomain,
        },
        {
          cache,
          safetyRules: options.safetyRules,
          version: options.promptVersion,
        },
      )

      const finish = (
        partial: PartialCore,
        writeCache: boolean,
      ): RouterDecision => {
        const decision = assemble(
          partial,
          l0.safety,
          layerPath,
          startedAt,
          options,
        )
        if (
          writeCache &&
          cache &&
          l0.cacheKey &&
          partial.decidedBy !== 'fallback' &&
          l0.safety.verdict !== 'reject'
        ) {
          cache.set(l0.cacheKey, toCacheCore(partial))
        }
        options.hooks?.onDecision?.(decision, input)
        return decision
      }

      if (l0.safety.verdict === 'reject') {
        return finish(
          {
            ...fallbackCore(l0.text, l0.safety.reason ?? 'safety-reject'),
            reason: l0.safety.reason ?? '安全护栏拒绝',
          },
          false,
        )
      }

      // L0 锁定 / 缓存命中
      if (l0.decision && l0.decidedBy) {
        layerPath.push(l0.decidedBy === 'cache' ? 'cache' : 'lock')
        let partial = fromRouteCore(l0.decision, l0.decidedBy)
        if (options.strongModel) {
          partial = await maybeUpgradeL3(partial, {
            text: l0.text,
            history: input.history,
            attachments: input.attachments,
            safety: l0.safety,
            strongModel: options.strongModel,
            timeoutMs: options.timeoutMs?.l3,
            signal: input.signal,
            accept,
            escalate,
            layerPath,
          })
        }
        return finish(partial, l0.decidedBy !== 'cache')
      }

      // L1
      layerPath.push('l1')
      const l1 = await runL1(
        {
          text: l0.text,
          history: input.history,
          attachments: input.attachments,
        },
        {
          search: options.search,
          embed: options.embed,
          acceptThreshold: accept,
        },
      )

      const facts =
        l1.kind === 'pass'
          ? l1.facts
          : extractFacts({
              text: l0.text,
              history: input.history,
              attachments: input.attachments,
            })

      let partial: PartialCore

      if (l1.kind === 'decide') {
        partial = {
          lane: l1.lane,
          domain: l1.domain,
          band: l1.band,
          confidence: l1.confidence,
          ambiguous: l1.ambiguous,
          decidedBy: l1.decidedBy,
          query: { ...l1.query },
          reason: l1.reason,
          clarification: l1.clarification,
        }
        // 高置信且无需升级 → 定案
        if (!needsL3(partial, l0.safety, escalate)) {
          return finish(partial, true)
        }
        // 需升级：有强模直接 L3；否则先走 L2 再视情况
        if (options.strongModel) {
          partial = await maybeUpgradeL3(partial, {
            text: l0.text,
            history: input.history,
            attachments: input.attachments,
            facts,
            safety: l0.safety,
            strongModel: options.strongModel,
            timeoutMs: options.timeoutMs?.l3,
            signal: input.signal,
            accept,
            escalate,
            layerPath,
          })
          return finish(partial, true)
        }
      }

      // L2（L1 pass，或 L1 需升级但无强模）
      layerPath.push('l2')
      const l2 = await classifyL2(
        {
          text: l0.text,
          history: input.history,
          attachments: input.attachments,
          facts,
        },
        {
          model: options.fastModel,
          timeoutMs: options.timeoutMs?.l2,
          signal: input.signal,
        },
      )

      if (l2.kind === 'unavailable') {
        if (l1.kind === 'decide') {
          return finish(
            {
              lane: l1.lane,
              domain: l1.domain,
              band: l1.band,
              confidence: l1.confidence,
              ambiguous: true,
              decidedBy: l1.decidedBy,
              query: { ...l1.query },
              reason: `${l1.reason}；L2 不可用（${l2.reason}），采纳 L1`,
              clarification: l1.clarification,
            },
            true,
          )
        }
        return finish(
          fallbackCore(l0.text, `L2 不可用：${l2.reason}`),
          false,
        )
      }

      partial = {
        lane: l2.lane,
        domain: l2.domain,
        band: l2.band,
        confidence: l2.confidence,
        ambiguous: l2.ambiguous,
        decidedBy: 'l2',
        query: { ...l2.query },
        reason: l2.reason,
        clarification: l2.clarification,
      }

      if (options.strongModel) {
        partial = await maybeUpgradeL3(partial, {
          text: l0.text,
          history: input.history,
          attachments: input.attachments,
          facts,
          safety: l0.safety,
          strongModel: options.strongModel,
          timeoutMs: options.timeoutMs?.l3,
          signal: input.signal,
          accept,
          escalate,
          layerPath,
        })
      }

      return finish(partial, true)
    },
  }
}
