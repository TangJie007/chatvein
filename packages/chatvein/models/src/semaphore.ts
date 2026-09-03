import type {
  ChatMessage,
  ChatModelLike,
  ModelInvokeOptions,
  ModelResult,
} from '@chatvein/common'

type Release = () => void

/**
 * 计数信号量：限制同时进行的异步操作数。
 *
 * `acquire()` 在有空位时立即返回 release，否则排队（FIFO）等待；
 * release 须在 finally 中调用。超额调用排队而非报错，用于把对同一模型的
 * 并发整形到网关可承受范围（防 429）。
 */
export class Semaphore {
  private active = 0
  private readonly waiters: Array<() => void> = []

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('Semaphore capacity 必须为 >= 1 的整数')
    }
  }

  /** 当前正在执行的操作数 */
  get inFlight(): number {
    return this.active
  }

  /** 排队等待的操作数 */
  get pending(): number {
    return this.waiters.length
  }

  async acquire(): Promise<Release> {
    if (this.active < this.capacity) {
      this.active++
    } else {
      // 排队；被唤醒时名额直接移交给本调用（FIFO 公平），无需再自增
      await new Promise<void>((resolve) => this.waiters.push(resolve))
    }
    let released = false
    return () => {
      if (released) return
      released = true
      this.release()
    }
  }

  private release(): void {
    const next = this.waiters.shift()
    if (next) {
      // 有名额等待者：直接移交，active 不变
      next()
    } else {
      this.active--
    }
  }
}

export interface ConcurrencyLimitedOptions {
  /** 最大并发 in-flight 调用数；默认 1（串行） */
  maxConcurrency?: number
}

/**
 * 装饰任意 ChatModelLike，用信号量限制并发调用数。
 * 不改变返回值/错误，仅做并发整形；内层模型抛出时名额也会释放。
 */
export class ConcurrencyLimitedChatModel implements ChatModelLike {
  readonly id: string
  private readonly sem: Semaphore

  constructor(
    private readonly inner: ChatModelLike,
    options: ConcurrencyLimitedOptions = {},
  ) {
    this.id = inner.id
    this.sem = new Semaphore(options.maxConcurrency ?? 1)
  }

  /** 最大并发数 */
  get maxConcurrency(): number {
    return this.sem.capacity
  }

  get inFlight(): number {
    return this.sem.inFlight
  }

  get pending(): number {
    return this.sem.pending
  }

  async invoke(messages: ChatMessage[], opts?: ModelInvokeOptions): Promise<ModelResult> {
    const release = await this.sem.acquire()
    try {
      return await this.inner.invoke(messages, opts)
    } finally {
      release()
    }
  }
}
