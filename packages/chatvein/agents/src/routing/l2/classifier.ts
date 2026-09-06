/**
 * L2：弱模型结构化路由（策略拍板 + 工具向改写）。
 *
 * - ReAct 图外单次调用
 * - Prompt：`formatL2PromptMessages`
 * - 模型路径：优先 `withStructuredOutput`，response_format 不支持时纯文本 JSON 兜底
 * - `callModel` 注入：始终走文本（单测 / 非 LangChain 后端）
 * - 无模型时 Passthrough（透传 L1）
 */
import type { BaseMessage } from '@langchain/core/messages'
import type { BaseChatModel } from '@langchain/core/language_models/chat_models'
import type { RouteDecision } from '@chatvein/common'
import type { HeuristicCtx } from '../l1/features'
import { mergeL2Judgement } from './merge'
import { formatL2PromptMessages } from './prompt'
import {
  extractJsonObject,
  parseL2Judgement,
  L2JudgementSchema,
  type L2Judgement,
} from './schema'

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
  /** 自定义调用；优先于 model（始终文本路径） */
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

type JudgementVia = 'structured' | 'text'

/**
 * 结构化 L2：messages → withStructuredOutput（优先）→ 文本 JSON 兜底 → merge。
 * 解析失败 / 超时 / 调用异常 → 保留 L1，并追加 reasons。
 */
export class StructuredL2Classifier implements L2Classifier {
  private readonly model?: BaseChatModel
  private readonly callModel?: L2ModelCall
  private readonly timeoutMs: number

  constructor(options: L2ClassifierOptions) {
    this.timeoutMs = options.timeoutMs ?? 12_000
    if (options.callModel) {
      this.callModel = options.callModel
    } else if (options.model) {
      this.model = options.model
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
      const { judgement, via } = await this.judge(messages, ac.signal)
      const merged = mergeL2Judgement(l1, judgement)
      return {
        ...merged,
        reasons: [...merged.reasons, via === 'structured' ? 'l2_structured' : 'l2_text'],
      }
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

  private async judge(
    messages: BaseMessage[],
    signal: AbortSignal,
  ): Promise<{ judgement: L2Judgement; via: JudgementVia }> {
    // 注入 callModel：单测 / 自定义后端，只走文本
    if (this.callModel) {
      const rawText = await this.callModel({ messages, signal })
      return {
        judgement: parseL2Judgement(extractJsonObject(rawText)),
        via: 'text',
      }
    }

    const model = this.model!
    const structured = await tryStructuredL2(model, messages, signal)
    if (structured.kind === 'ok') {
      return { judgement: structured.judgement, via: 'structured' }
    }
    if (structured.kind === 'fatal') {
      throw structured.error
    }

    // response_format 不支持 / 无 withStructuredOutput → 纯文本 JSON
    const res = await model.invoke(messages, { signal })
    return {
      judgement: parseL2Judgement(extractJsonObject(messageContentToString(res.content))),
      via: 'text',
    }
  }
}

type StructuredL2Attempt =
  | { kind: 'ok'; judgement: L2Judgement }
  | { kind: 'unsupported' }
  | { kind: 'fatal'; error: unknown }

async function tryStructuredL2(
  model: BaseChatModel,
  messages: BaseMessage[],
  signal: AbortSignal,
): Promise<StructuredL2Attempt> {
  if (typeof model.withStructuredOutput !== 'function') {
    return { kind: 'unsupported' }
  }
  try {
    const extractor = model.withStructuredOutput(L2JudgementSchema, { name: 'l2_route' })
    const raw = await extractor.invoke(messages, { signal })
    return { kind: 'ok', judgement: parseL2Judgement(raw) }
  } catch (err) {
    if (isResponseFormatUnsupported(err)) return { kind: 'unsupported' }
    if (isFatalLlmError(err) || abortLike(err)) return { kind: 'fatal', error: err }
    // 其它结构化失败：仍尝试文本兜底
    return { kind: 'unsupported' }
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

/** 端不支持 response_format / json_schema（与工具 C2 同判定） */
export function isResponseFormatUnsupported(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /response_format|json_schema|structured.?output|unavailable now|not support.*json/i.test(
    msg,
  )
}

function isFatalLlmError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err)
  return /timeout|401|unauthorized|invalid.*key|ENOTFOUND|ECONNREFUSED/i.test(msg)
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
