import { ChatOpenAI } from '@langchain/openai'
import { maybeDevLlmCallbacks, type LlmDebugSink } from './dev-llm-callback'
import type { OpenAICompatibleConfig } from './openai-compatible'

export interface CreateLangChainChatModelOptions {
  /**
   * 仅在显式传入时挂 LangChain 调试回调。
   * Electron 默认不要挂：回调曾导致 ReAct invoke 卡住、发送无响应。
   */
  onLlmDebug?: LlmDebugSink
}

/**
 * 把 OpenAI 兼容端点配置桥成 LangChain `ChatOpenAI`，供 LangGraph
 *（`createReactAgent` / `StateGraph`）使用。
 *
 * 与 `OpenAICompatibleChatModel`（fetch 直连）并存：单测/简单路径用 fetch；
 * 需要 tool-calling 图时用本桥接。
 */
export function createLangChainChatModel(
  cfg: OpenAICompatibleConfig,
  options?: CreateLangChainChatModelOptions,
): ChatOpenAI {
  const baseURL = cfg.baseUrl.trim().replace(/\/+$/, '')
  const callbacks = options?.onLlmDebug ? maybeDevLlmCallbacks(options.onLlmDebug) : []
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey || 'EMPTY',
    temperature: cfg.temperature ?? 0.2,
    maxTokens: cfg.maxTokens && cfg.maxTokens > 0 ? cfg.maxTokens : undefined,
    configuration: { baseURL },
    ...(callbacks.length ? { callbacks } : {}),
  })
}
