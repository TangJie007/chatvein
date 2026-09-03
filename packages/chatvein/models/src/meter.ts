import {
  addTokenUsage,
  emptyTokenStat,
  emptyTokenUsage,
  type ChatMessage,
  type ChatModelLike,
  type ModelInvokeOptions,
  type ModelResult,
  type TokenStat,
  type TokenUsage,
} from '@chatvein/common'

export type MeterListener = (info: {
  modelId: string
  result: ModelResult
}) => void

/** 装饰任意 ChatModelLike，累加 TokenStat */
export class MeteredChatModel implements ChatModelLike {
  readonly id: string
  private stat: TokenStat = emptyTokenStat()
  private readonly listeners = new Set<MeterListener>()

  constructor(private readonly inner: ChatModelLike) {
    this.id = inner.id
  }

  onCall(listener: MeterListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getStat(): TokenStat {
    return {
      byModel: { ...this.stat.byModel },
      total: { ...this.stat.total },
    }
  }

  resetStat(): void {
    this.stat = emptyTokenStat()
  }

  async invoke(messages: ChatMessage[], opts?: ModelInvokeOptions): Promise<ModelResult> {
    const result = await this.inner.invoke(messages, opts)
    this.record(result.model || this.id, result.usage)
    for (const listener of this.listeners) {
      try {
        listener({ modelId: this.id, result })
      } catch {
        // ignore
      }
    }
    return result
  }

  private record(model: string, usage: TokenUsage): void {
    const prev = this.stat.byModel[model] ?? emptyTokenUsage()
    this.stat.byModel[model] = addTokenUsage(prev, usage)
    this.stat.total = addTokenUsage(this.stat.total, usage)
  }
}
