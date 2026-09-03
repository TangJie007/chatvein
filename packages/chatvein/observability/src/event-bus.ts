import type { TraceEvent } from '@chatvein/common'

export type TraceListener = (event: TraceEvent) => void

/** 进程内事件总线；不持久化 */
export class EventBus {
  private listeners = new Set<TraceListener>()

  on(listener: TraceListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  emit(event: TraceEvent): void {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch {
        // 监听方异常不打断其它订阅者
      }
    }
  }

  clear(): void {
    this.listeners.clear()
  }
}
