import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { Serialized } from '@langchain/core/load/serializable'
import type { BaseMessage } from '@langchain/core/messages'
import type { LLMResult } from '@langchain/core/outputs'
import { isLlmDebugLogEnabled, logLlmResponse } from './llm-debug-log'

export type LlmDebugSink = (source: string, payload: unknown) => void

/** 请求级 sink（Electron chat 在 invoke 前后挂上，避免 LangChain 丢闭包） */
let activeSink: LlmDebugSink | undefined

export function setLlmDebugSink(sink: LlmDebugSink | undefined): () => void {
  activeSink = sink
  return () => {
    if (activeSink === sink) activeSink = undefined
  }
}

export function getLlmDebugSink(): LlmDebugSink | undefined {
  return activeSink
}

/** 把 BaseMessage 收成可读摘要（避免整坨 lc constructor） */
export function summarizeMessagesForDebug(messages: unknown): unknown {
  if (!Array.isArray(messages)) return messages
  return messages.map((m) => summarizeOneMessage(m))
}

function summarizeOneMessage(m: unknown): unknown {
  if (!m || typeof m !== 'object') return m
  const msg = m as BaseMessage & {
    getType?: () => string
    tool_calls?: unknown
    name?: string
    content?: unknown
  }
  const role =
    typeof msg.getType === 'function'
      ? msg.getType()
      : (msg as { type?: string }).type ?? 'unknown'
  const out: Record<string, unknown> = { role }
  if (msg.name) out.name = msg.name
  if (msg.content !== undefined) out.content = truncateContent(msg.content)
  if (Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
    out.tool_calls = msg.tool_calls
  }
  return out
}

function truncateContent(content: unknown, max = 4_000): unknown {
  if (typeof content === 'string') {
    return content.length <= max
      ? content
      : `${content.slice(0, max)}…[truncated ${content.length - max}]`
  }
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        const text = String((part as { text: unknown }).text ?? '')
        return {
          ...part,
          text:
            text.length <= max ? text : `${text.slice(0, max)}…[truncated ${text.length - max}]`,
        }
      }
      return part
    })
  }
  return content
}

function summarizeLlmResult(output: LLMResult): unknown {
  const generations = output.generations?.map((gens) =>
    gens.map((g) => {
      const withMsg = g as { text?: string; message?: BaseMessage }
      return {
        text: truncateContent(withMsg.text ?? '', 4_000),
        message: withMsg.message ? summarizeOneMessage(withMsg.message) : undefined,
      }
    }),
  )
  return {
    generations,
    llmOutput: output.llmOutput,
  }
}

/**
 * LangChain 回调：每次 Chat/LLM 调用的入参 + 出参（不阻塞模型调用）。
 * Electron 须显式传入 sink 或配合 setLlmDebugSink；禁止无条件自动挂。
 */
export class DevLlmLogCallbackHandler extends BaseCallbackHandler {
  name = 'chatvein_dev_llm_log'
  awaitHandlers = false

  constructor(private readonly sink?: LlmDebugSink) {
    super({ _awaitHandler: false })
  }

  handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void {
    this.flushDebugLog('langchain:request', {
      runId,
      parentRunId,
      llm: llm?.id ?? (llm as { name?: string })?.name,
      messages: messages.map((batch) => summarizeMessagesForDebug(batch)),
      invocationParams: extraParams?.invocation_params ?? extraParams?.options ?? extraParams,
    })
  }

  handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void {
    // ChatModel 通常走 handleChatModelStart；纯 LLM 走这里
    this.flushDebugLog('langchain:request', {
      runId,
      parentRunId,
      llm: llm?.id ?? (llm as { name?: string })?.name,
      prompts: prompts.map((p) =>
        p.length <= 4_000 ? p : `${p.slice(0, 4_000)}…[truncated ${p.length - 4_000}]`,
      ),
      invocationParams: extraParams?.invocation_params ?? extraParams?.options ?? extraParams,
    })
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    this.flushDebugLog('langchain:response', {
      runId,
      output: summarizeLlmResult(output),
    })
  }

  handleLLMError(err: Error, runId: string): void {
    this.flushDebugLog('langchain:error', {
      runId,
      name: err.name,
      message: err.message,
      stack: err.stack,
    })
  }

  /** 勿命名为 emit：会覆盖 BaseCallbackHandler / EventEmitter.emit */
  private flushDebugLog(source: string, payload: unknown): void {
    // 在回调当下捕获 sink：invoke 的 finally 会清掉 activeSink，setImmediate 时必须用闭包
    const sink = this.sink ?? activeSink
    setImmediate(() => {
      try {
        if (sink) sink(source, payload)
        else if (isLlmDebugLogEnabled()) logLlmResponse(source, payload)
      } catch {
        // 调试不得影响对话
      }
    })
  }
}

/**
 * 显式传入 sink 才挂回调。
 * 可用 `(s,p) => getLlmDebugSink()?.(s,p)` 做「仅当请求期内有 activeSink 才输出」。
 */
export function maybeDevLlmCallbacks(sink?: LlmDebugSink): DevLlmLogCallbackHandler[] {
  if (!sink) return []
  return [new DevLlmLogCallbackHandler(sink)]
}

/** 转发到当前请求的 activeSink（给 L2 等长生命周期模型用） */
export function forwardToActiveLlmDebugSink(source: string, payload: unknown): void {
  activeSink?.(source, payload)
}
