/**
 * L2：弱模型结构化路由分类（灰区 / unknown）。
 *
 * - 在 ReAct 图外单独调用，不增加 ReAct 多轮
 * - 不做对话意图（语义理解仍归主模型）；只产出可执行 RoutePolicy 补丁
 * - 无模型配置时退回 Passthrough（透传 L1）
 */
import { HumanMessage, SystemMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { RouteDecision } from '@chatvein/common'
import type { HeuristicCtx } from '../l1/features'
import { mergeL2Judgement } from './merge'
import { buildL2UserPrompt, L2_SYSTEM_PROMPT } from './prompt'
import { extractJsonObject, parseL2Judgement } from './schema'

export interface L2Classifier {
  classify(ctx: HeuristicCtx, l1: RouteDecision): Promise<RouteDecision>
}

/** 可注入的纯文本调用（单测 / 非 LangChain 后端） */
export type L2ModelCall = (input: {
  system: string
  user: string
  signal?: AbortSignal
}) => Promise<string>

export interface L2ClassifierOptions {
  /** LangChain Chat 模型（与 ReAct 同源桥接即可；宜弱模 + 低温） */
  model?: BaseChatModel
  /** 自定义调用；优先于 model */
  callModel?: L2ModelCall
  /** 超时（ms），默认 12s；超时则保留 L1 */
  timeoutMs?: number
}

/** 未配置模型：透传 L1 */
export class PassthroughL2Classifier implements L2Classifier {
  async classify(_ctx: HeuristicCtx, l1: RouteDecision): Promise<RouteDecision> {
    return l1
  }
}

/**
 * 结构化 L2：prompt → JSON → zod → mergeL2Judgement。
 * 解析失败 / 超时 / 调用异常 → 保留 L1，并追加 reasons。
 */
export class StructuredL2Classifier implements L2Classifier {
  private readonly callModel: L2ModelCall
  private readonly timeoutMs: number

  constructor(options: L2ClassifierOptions) {
    this.timeoutMs = options.timeoutMs ?? 12_000
    if (options.callModel) {
      this.callModel = options.callModel
    } else if (options.model) {
      const model = options.model
      this.callModel = async ({ system, user, signal }) => {
        const res = await model.invoke(
          [new SystemMessage(system), new HumanMessage(user)],
          signal ? { signal } : undefined,
        )
        return messageContentToString(res.content)
      }
    } else {
      throw new Error('StructuredL2Classifier: 需要 model 或 callModel')
    }
  }

  async classify(ctx: HeuristicCtx, l1: RouteDecision): Promise<RouteDecision> {
    if (l1.terminal) return l1

    const ac = new AbortController()
    const timer = setTimeout(() => ac.abort(), this.timeoutMs)
    try {
      // —— 重点：图外单次调用，与主对话 ReAct 隔离 ——
      const rawText = await this.callModel({
        system: L2_SYSTEM_PROMPT,
        user: buildL2UserPrompt(ctx, l1),
        signal: ac.signal,
      })
      const judgement = parseL2Judgement(extractJsonObject(rawText))
      return mergeL2Judgement(l1, judgement)
    } catch (err) {
      const tag = abortLike(err) ? 'l2_timeout' : 'l2_failed'
      return {
        ...l1,
        reasons: [...l1.reasons, tag],
      }
    } finally {
      clearTimeout(timer)
    }
  }
}

export function createL2Classifier(options?: L2ClassifierOptions): L2Classifier {
  if (options?.model || options?.callModel) {
    return new StructuredL2Classifier(options)
  }
  return new PassthroughL2Classifier()
}

/** 是否应进入 L2：低置信、band unknown、或 tools 待判（unknown） */
export function shouldEscalateToL2(decision: RouteDecision): boolean {
  if (decision.terminal) return false
  return (
    !decision.confident ||
    decision.band === 'unknown' ||
    decision.policy.tools === 'unknown'
  )
}

function abortLike(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false
  const name = (err as { name?: string }).name
  const msg = err instanceof Error ? err.message : String(err)
  return name === 'AbortError' || /abort|timeout/i.test(msg)
}

function messageContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string') return part
        if (part && typeof part === 'object' && 'text' in part) {
          return String((part as { text: unknown }).text ?? '')
        }
        return ''
      })
      .join('')
  }
  return content == null ? '' : String(content)
}
