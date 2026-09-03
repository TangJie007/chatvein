import type {
  ChatModelLike,
  ModelEndpointConfig,
  ModelTier,
} from '@chatvein/common'
import { OpenAICompatibleChatModel } from './openai-compatible'
import { ConcurrencyLimitedChatModel } from './semaphore'
import { ModelRouter, type ModelRouterOptions } from './router'

/**
 * 由单个端点配置构建模型：OpenAI 兼容直连 + 并发信号量限流。
 * `maxConcurrency` 缺省/<=1 时不包装饰器（本就串行）。
 */
export function createEndpointModel(cfg: ModelEndpointConfig): ChatModelLike {
  const model = new OpenAICompatibleChatModel({
    id: cfg.id,
    baseUrl: cfg.baseUrl,
    apiKey: cfg.apiKey,
    model: cfg.model,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
  })
  const concurrency = cfg.maxConcurrency ?? 1
  return concurrency > 1
    ? new ConcurrencyLimitedChatModel(model, { maxConcurrency: concurrency })
    : model
}

/**
 * 由 ForgeConfig 的三档端点构建带降级链的路由。
 * 同一档内多个端点即按顺序作为降级备用链。
 */
export function createModelRouter(
  tiers: Record<ModelTier, ModelEndpointConfig[]>,
  options: Pick<ModelRouterOptions, 'maxAttempts' | 'onFallback'> = {},
): ModelRouter {
  const build = (list: ModelEndpointConfig[]) => list.map(createEndpointModel)
  return new ModelRouter({
    tiers: {
      strong: build(tiers.strong ?? []),
      medium: build(tiers.medium ?? []),
      weak: build(tiers.weak ?? []),
    },
    ...options,
  })
}
