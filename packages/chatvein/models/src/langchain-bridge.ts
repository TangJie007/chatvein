import { ChatOpenAI } from '@langchain/openai'
import { llmTelemetryCallbacks } from './llm-telemetry-callback'
import type { OpenAICompatibleConfig } from './openai-compatible'

/**
 * 把 OpenAI 兼容端点配置桥成 LangChain `ChatOpenAI`，供 LangGraph
 *（`createReactAgent` / `StateGraph`）使用。
 *
 * 与 `OpenAICompatibleChatModel`（fetch 直连）并存：单测/简单路径用 fetch；
 * 需要 tool-calling 图时用本桥接。
 *
 * 始终挂遥测探针（`llm:*` 事件）；探针无状态、发送异步且按遥测开关落地，
 * 不影响模型调用，故无需调用方传开关。
 */
export function createLangChainChatModel(cfg: OpenAICompatibleConfig): ChatOpenAI {
  const baseURL = cfg.baseUrl.trim().replace(/\/+$/, '')
  return new ChatOpenAI({
    model: cfg.model,
    apiKey: cfg.apiKey || 'EMPTY',
    temperature: cfg.temperature ?? 0.2,
    maxTokens: cfg.maxTokens && cfg.maxTokens > 0 ? cfg.maxTokens : undefined,
    configuration: { baseURL },
    callbacks: [...llmTelemetryCallbacks],
  })
}
