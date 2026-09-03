/**
 * @chatvein/models
 * OpenAI 兼容网关：直连适配 + 计量 + 分档路由降级。
 */

export const CHATVEIN_MODELS_VERSION = '0.1.0'

export {
  OpenAICompatibleChatModel,
  type OpenAICompatibleConfig,
} from './openai-compatible'
export { MeteredChatModel, type MeterListener } from './meter'
export { ModelRouter, type ModelRouterOptions } from './router'
