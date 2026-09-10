import { app } from 'electron'
import { META, readMetadata, Logger, type AppEventEntry, type AppEventName } from '@electrum/common'
import type { DIContainer } from '../di/container'
import type { ScannedModule } from '../module/scanner'

/**
 * 把 Controller / Provider 上的 `@AppEvent` 接到 Electron `app.on`。
 *
 * 与 IpcBridge（渲染进程 ↔ 主进程 IPC）不同，这里监听的是应用生命周期事件，
 * 例如 `ready`、`window-all-closed`、`activate`、`before-quit` 等。
 * 其中 `ready`：若注册时 `app.isReady()` 已为 true，会补一次调用（因为
 * Application.start 先 await whenReady，原生 `app.on('ready')` 不会再触发）。
 *
 * 流程：读 META.APP_EVENT → resolve 实例 → `app.on(event, (...args) => instance[method](...args))`
 * Application.start 里在 IpcBridge 之后调用 `registerAll()`。
 */
export class EventBridge {
  private logger = new Logger('EventBridge')
  private registeredListeners: Array<{ event: AppEventName; listener: (...args: any[]) => void }> = []

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

      // AppEventName 已在装饰器侧收窄；此处 as any 仅绕过 app.on 字面量重载
      app.on(event as any, listener)
      this.registeredListeners.push({ event, listener })
      this.logger.debug(`Bound app.on("${event}") → ${targetClass.name}.${String(method)}`)

      // Application.start 会先 await whenReady 再 registerAll，此时再 app.on('ready')
      // 不会补发。已就绪则补一次调用，行为对齐「绑在 ready 之前」的语义。
      if (event === 'ready' && app.isReady()) {
        queueMicrotask(() => listener())
      }
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
