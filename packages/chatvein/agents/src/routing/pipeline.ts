/**
 * 路由管线：L1（启发式）→ 可选 L2（弱模结构化）→ 预留 L3。
 *
 * L2 在 ReAct 之外；语义意图仍由主模型在 ReAct 内理解。
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
  /** 注入 L2；默认无模型 → Passthrough */
  l2?: L2Classifier
  /** 是否在灰区调用 L2（默认 true） */
  enableL2?: boolean
}

/**
 * 对外主入口（兼容原 HeuristicRouter 名）。
 * 先跑 L1；低置信 / unknown 且非 terminal 时再走 L2。
 */
export class HeuristicRouter {
  private readonly l1: L1HeuristicRouter
  private l2: L2Classifier
  private enableL2: boolean

  constructor(options: HeuristicRouterOptions = {}) {
    this.l1 = createL1Router(options)
    this.l2 = options.l2 ?? createL2Classifier()
    this.enableL2 = options.enableL2 !== false
  }

  /** 热更新 L2（例如 app 绑定弱模后注入 StructuredL2Classifier） */
  setL2(l2: L2Classifier, enableL2 = true): void {
    this.l2 = l2
    this.enableL2 = enableL2
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

    // —— 重点：仅灰区 escalate；terminal / 高置信寒暄不进 L2 ——
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

/** 重建默认单例（测试或注入 L2 模型时） */
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
export { loadDefaultPrototypes }
