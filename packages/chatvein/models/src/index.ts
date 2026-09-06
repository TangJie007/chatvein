/**
 * @chatvein/models
 * OpenAI 兼容网关：直连适配 + 并发信号量 + 计量 + 分档路由降级 + 配置工厂。
 */

export const CHATVEIN_MODELS_VERSION = '0.1.0'

export {
  OpenAICompatibleChatModel,
  type OpenAICompatibleConfig,
} from './openai-compatible'
export { MeteredChatModel, type MeterListener } from './meter'
export { ModelRouter, type ModelRouterOptions } from './router'
export {
  Semaphore,
  ConcurrencyLimitedChatModel,
  type ConcurrencyLimitedOptions,
} from './semaphore'
export { createEndpointModel, createModelRouter } from './factory'
export { createLangChainChatModel } from './langchain-bridge'
export {
  LlmTelemetryCallbackHandler,
  llmTelemetryCallbacks,
  summarizeMessages,
} from './llm-telemetry-callback'
