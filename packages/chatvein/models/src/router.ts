import {
  ModelError,
  NotFoundError,
  type ChatMessage,
  type ChatModelLike,
  type ModelInvokeOptions,
  type ModelResult,
  type ModelTier,
} from '@chatvein/common'

export interface ModelRouterOptions {
  /** 档 → 模型；同档可配备用链（按顺序） */
  tiers: Record<ModelTier, ChatModelLike[]>
  /** 单次 invoke 最多尝试次数（含首发） */
  maxAttempts?: number
  onFallback?: (info: {
    tier: ModelTier
    fromId: string
    toId: string
    attempt: number
    error: Error
  }) => void
}

/**
 * 按档选模型；超时/限流/5xx 时沿备用链降级。
 */
export class ModelRouter {
  private readonly maxAttempts: number

  constructor(private readonly options: ModelRouterOptions) {
    this.maxAttempts = options.maxAttempts ?? 3
  }

  async invoke(
    tier: ModelTier,
    messages: ChatMessage[],
    opts?: ModelInvokeOptions,
  ): Promise<ModelResult & { modelId: string; tier: ModelTier }> {
    const chain = this.options.tiers[tier]
    if (!chain?.length) throw new NotFoundError(`未配置模型档：${tier}`)

    let lastError: Error | undefined
    const attempts = Math.min(this.maxAttempts, chain.length)

    for (let i = 0; i < attempts; i++) {
      const model = chain[i]!
      try {
        const result = await model.invoke(messages, opts)
        return { ...result, modelId: model.id, tier }
      } catch (err) {
        lastError = err as Error
        if (!isRetryable(err) || i >= attempts - 1) break
        const next = chain[i + 1]
        if (!next) break
        this.options.onFallback?.({
          tier,
          fromId: model.id,
          toId: next.id,
          attempt: i + 1,
          error: lastError,
        })
      }
    }

    throw lastError ?? new ModelError('模型调用失败', 'MODEL_FAILED')
  }
}

function isRetryable(err: unknown): boolean {
  if (!(err instanceof ModelError)) return false
  return (
    err.code === 'MODEL_TIMEOUT' ||
    err.code === 'MODEL_RATE_LIMIT' ||
    err.code === 'MODEL_HTTP' ||
    err.code === 'MODEL_NETWORK'
  )
}
