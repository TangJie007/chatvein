/**
 * L3 模型调用：withStructuredOutput 主路径 → 纯文本 JSON 兜底。
 * 失败不重试，返回 null 由编排层标 unavailable（同 L2）。
 */
import type { LanguageModelLike } from '@langchain/core/language_models/base'
import type { BaseMessage } from '@langchain/core/messages'
import { contentToString, extractJsonObject, withTimeoutSignal } from '../../shared'
import { L3RawSchema, parseL3Judgement } from './schema'
import type { L3Judgement } from './types'

export interface InvokeL3Options {
  model: LanguageModelLike
  messages: BaseMessage[]
  temperature?: number
  maxTokens?: number
  timeoutMs: number
  signal?: AbortSignal
}

type StructuredInvoker = {
  invoke: (messages: BaseMessage[], opts?: unknown) => Promise<unknown>
}

function callOptions(opts: InvokeL3Options): Record<string, unknown> {
  const signal = withTimeoutSignal(opts.timeoutMs, opts.signal)
  return {
    signal,
    temperature: opts.temperature ?? 0,
    maxTokens: opts.maxTokens,
  }
}

/**
 * 单次重判调用。
 * @returns 解析后的判定；任何失败返回 null（不抛、不重试）
 */
export async function invokeL3(options: InvokeL3Options): Promise<L3Judgement | null> {
  const { model, messages } = options
  const invokeOpts = callOptions(options)

  const withStructured = (model as { withStructuredOutput?: unknown }).withStructuredOutput
  if (typeof withStructured === 'function') {
    try {
      const extractor = (
        withStructured as (
          schema: typeof L3RawSchema,
          opts?: { name: string },
        ) => StructuredInvoker
      ).call(model, L3RawSchema, { name: 'router_l3' })
      return parseL3Judgement(await extractor.invoke(messages, invokeOpts))
    } catch {
      // response_format 不支持 / 校验失败 → 落文本；文本也不行则 null
    }
  }

  try {
    const res = await (
      model as {
        invoke: (
          m: BaseMessage[],
          o?: unknown,
        ) => Promise<{ content: unknown }>
      }
    ).invoke(messages, invokeOpts)
    return parseL3Judgement(extractJsonObject(contentToString(res.content)))
  } catch {
    return null
  }
}
