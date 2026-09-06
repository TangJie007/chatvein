/**
 * L2：弱模型结构化路由（策略拍板 + 工具向改写）。
 *
 * - ReAct 图外单次调用
 * - Prompt：`formatL2PromptMessages` → messages → 弱模
 * - 无模型时 Passthrough（透传 L1）
 */
import type { BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { RouteDecision } from '@chatvein/common'
import type { HeuristicCtx } from '../l1/features'
import { mergeL2Judgement } from './merge'
import { formatL2PromptMessages } from './prompt'
import { extractJsonObject, parseL2Judgement } from './schema'

export interface L2Classifier {
  classify(ctx: HeuristicCtx, l1: RouteDecision): Promise<RouteDecision>
}

/** 可注入调用（单测）：入参已是 ChatPromptTemplate 格式化后的 messages */
export type L2ModelCall = (input: {
  messages: BaseMessage[]
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
 * 结构化 L2：formatL2PromptMessages → 弱模 → JSON → zod → mergeL2Judgement。
 * 解析失败 / 超时 / 调用异常 → 保留 L1，并追加 reasons。
 */
export class StructuredL2Classifier implements L2Classifier {
  private readonly invokeRaw: (
    messages: BaseMessage[],
    signal: AbortSignal,
  ) => Promise<string>
  private readonly timeoutMs: number

  constructor(options: L2ClassifierOptions) {
    this.timeoutMs = options.timeoutMs ?? 12_000
    if (options.callModel) {
      const callModel = options.callModel
      this.invokeRaw = async (messages, signal) => callModel({ messages, signal })
    } else if (options.model) {
      const model = options.model
      this.invokeRaw = async (messages, signal) => {
        const res = await model.invoke(messages, { signal })
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
      const messages = await formatL2PromptMessages(ctx, l1)
      const rawText = await this.invokeRaw(messages, ac.signal)
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

/**
 * 是否应进入 L2。
 * L1 仅寒暄/自我介绍高置信短路；其余为 unknown / 低置信 / tools:unknown → 必 escalate。
 * terminal（empty/slash/mention）不进 L2。
 */
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
