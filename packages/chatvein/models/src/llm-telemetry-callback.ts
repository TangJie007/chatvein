import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { Serialized } from '@langchain/core/load/serializable'
import type { BaseMessage } from '@langchain/core/messages'
import type { LLMResult } from '@langchain/core/outputs'
import { emitTelemetry } from '@chatvein/observability'

/**
 * LangChain 遥测探针：把每次 Chat/LLM 调用转成统一遥测链路。
 *
 * 一次模型调用对应三条可关联事件（事件名统一为 `llm:request/response/error`）：
 * - 信封 `spanId` = LangChain runId；`traceId` 由请求级上下文注入（会话 runId），
 *   从而 LLM span 正确挂在业务 trace 之下；
 * - response/error 带 `durationMs` 与 `status`，token 用量抬到 `attrs.tokens`；
 * - `attrs.source` 区分来源（langchain / openai-compatible 直连）。
 *
 * 探针无状态、始终可安全挂载：是否落地、落到哪由遥测核心的 sink/开关决定，
 * 发送经 setImmediate 异步化，绝不阻塞或影响模型调用。
 */
export class LlmTelemetryCallbackHandler extends BaseCallbackHandler {
  name = 'chatvein_llm_telemetry'
  awaitHandlers = false

  /** runId -> 起始时间与模型标识，用于在 end/error 时补耗时与维度 */
  private readonly pending = new Map<string, { start: number; model?: unknown }>()

  handleChatModelStart(
    llm: Serialized,
    messages: BaseMessage[][],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void {
    this.pending.set(runId, { start: Date.now(), model: modelLabel(llm) })
    this.emit('llm:request', runId, {
      messages: messages.map((batch) => summarizeMessages(batch)),
      invocationParams: extraParams?.invocation_params ?? extraParams?.options ?? extraParams,
    })
  }

  handleLLMStart(
    llm: Serialized,
    prompts: string[],
    runId: string,
    _parentRunId?: string,
    extraParams?: Record<string, unknown>,
  ): void {
    // ChatModel 通常走 handleChatModelStart；纯 LLM 走这里
    this.pending.set(runId, { start: Date.now(), model: modelLabel(llm) })
    this.emit('llm:request', runId, {
      prompts: prompts.map((p) => truncate(p, 4_000)),
      invocationParams: extraParams?.invocation_params ?? extraParams?.options ?? extraParams,
    })
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    const p = this.pending.get(runId)
    this.pending.delete(runId)
    const tokens = extractTokenUsage(output.llmOutput)
    this.emit(
      'llm:response',
      runId,
      { output: summarizeLlmResult(output) },
      {
        status: 'ok',
        durationMs: p ? Date.now() - p.start : undefined,
        attrs: { source: 'langchain', ...(p?.model ? { model: p.model } : {}), ...(tokens ? { tokens } : {}) },
      },
    )
  }

  handleLLMError(err: Error, runId: string): void {
    const p = this.pending.get(runId)
    this.pending.delete(runId)
    this.emit(
      'llm:error',
      runId,
      { name: err.name, message: err.message, stack: err.stack },
      {
        status: 'error',
        error: err.message,
        durationMs: p ? Date.now() - p.start : undefined,
        attrs: { source: 'langchain', ...(p?.model ? { model: p.model } : {}) },
      },
    )
  }

  /** 勿命名为 emit：会覆盖 BaseCallbackHandler / EventEmitter.emit */
  private emit(
    name: string,
    runId: string,
    payload: Record<string, unknown>,
    opts?: {
      status?: 'ok' | 'error'
      durationMs?: number
      attrs?: Record<string, unknown>
      error?: string
    },
  ): void {
    setImmediate(() => {
      try {
        emitTelemetry(name, { runId, ...payload }, { spanId: runId, ...opts })
      } catch {
        // 遥测不得影响对话
      }
    })
  }
}

function modelLabel(llm: Serialized): unknown {
  return llm?.id ?? (llm as { name?: string } | undefined)?.name
}

function extractTokenUsage(llmOutput?: Record<string, unknown> | null): Record<string, unknown> | undefined {
  if (!llmOutput) return undefined
  const usage =
    (llmOutput.tokenUsage as Record<string, unknown> | undefined) ??
    (llmOutput.usage as Record<string, unknown> | undefined) ??
    (llmOutput.estimatedTokenUsage as Record<string, unknown> | undefined)
  return usage && Object.keys(usage).length ? usage : undefined
}

/** 把 BaseMessage 列表收成可读摘要（避免整坨 lc constructor） */
export function summarizeMessages(messages: unknown): unknown {
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

function truncate(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max)}…[truncated ${text.length - max}]`
}

function truncateContent(content: unknown, max = 4_000): unknown {
  if (typeof content === 'string') return truncate(content, max)
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (part && typeof part === 'object' && 'text' in part) {
        const text = String((part as { text: unknown }).text ?? '')
        return {
          ...part,
          text: truncate(text, max),
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
 * 无状态单例：LangChain 模型直接 spread 即可，无需工厂或布尔开关。
 * 给每个模型一份副本，避免 LangChain 内部对 callbacks 数组做 in-place 变更时互相影响。
 */
export const llmTelemetryCallbacks: LlmTelemetryCallbackHandler[] = [new LlmTelemetryCallbackHandler()]
