import { app } from 'electron'
import { META, readMetadata, Logger, type AppEventEntry } from '@electrum/common'
import type { DIContainer } from '../di/container'
import type { ScannedModule } from '../module/scanner'

/**
 * 把 Controller / Provider 上的 `@AppEvent` 接到 Electron `app.on`。
 *
 * 与 IpcBridge（渲染进程 ↔ 主进程 IPC）不同，这里监听的是应用生命周期事件，
 * 例如 `ready`、`window-all-closed`、`activate`、`before-quit` 等。
 *
 * 流程：读 META.APP_EVENT → resolve 实例 → `app.on(event, (...args) => instance[method](...args))`
 * Application.start 里在 IpcBridge 之后调用 `registerAll()`。
 */
export class EventBridge {
  private logger = new Logger('EventBridge')
  private registeredListeners: Array<{ event: string; listener: (...args: any[]) => void }> = []

  constructor(
    private container: DIContainer,
    private scannedModules: ScannedModule[],
  ) {}

  /** 遍历已扫描模块的 controllers + providers，绑定所有 @AppEvent */
  registerAll(): void {
    for (const mod of this.scannedModules) {
      for (const cls of [...mod.controllers, ...mod.providers]) {
        this.bindEvents(cls)
      }
    }
  }

  private bindEvents(targetClass: Function): void {
    const handlers = readMetadata<AppEventEntry[]>(targetClass, META.APP_EVENT) || []
    if (handlers.length === 0) return

    const instance = this.container.resolve<any>(targetClass)

    for (const { event, method } of handlers) {
      const listener = (...args: any[]) => {
        try {
          const result = instance[method](...args)
          if (result instanceof Promise) {
            result.catch((err: Error) =>
              this.logger.error(`AppEvent "${event}" error: ${err.message}`),
            )
          }
        } catch (err: any) {
          this.logger.error(`AppEvent "${event}" error: ${err.message}`)
        }
      }

      app.on(event as any, listener)
      this.registeredListeners.push({ event: event as string, listener })
      this.logger.debug(`Bound app.on("${event}") → ${targetClass.name}.${String(method)}`)
    }
  }

  /** 拆除本桥接注册过的全部 app 事件监听，供 Application.shutdown 调用 */
  unregisterAll(): void {
    for (const { event, listener } of this.registeredListeners) {
      app.removeListener(event as any, listener)
    }
    this.registeredListeners = []
  }
}
