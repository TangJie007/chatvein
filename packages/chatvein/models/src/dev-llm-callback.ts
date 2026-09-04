import { BaseCallbackHandler } from '@langchain/core/callbacks/base'
import type { LLMResult } from '@langchain/core/outputs'
import { logLlmResponse } from './llm-debug-log'

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

/** LangChain 回调：每次 LLM/ChatModel 结束时记录返回（不阻塞模型调用） */
export class DevLlmLogCallbackHandler extends BaseCallbackHandler {
  name = 'chatvein_dev_llm_log'
  awaitHandlers = false

  constructor(private readonly sink?: LlmDebugSink) {
    super({ _awaitHandler: false })
  }

  handleLLMEnd(output: LLMResult, runId: string): void {
    this.flushDebugLog('langchain', { runId, output })
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
        else logLlmResponse(source, payload)
      } catch {
        // 调试不得影响对话
      }
    })
  }
}

export function maybeDevLlmCallbacks(sink?: LlmDebugSink): DevLlmLogCallbackHandler[] {
  // 必须显式传入 sink 才挂回调；禁止「开发环境自动挂」以免卡死 Electron 发送
  if (!sink) return []
  return [new DevLlmLogCallbackHandler(sink)]
}
