import { ipcMain } from 'electron'
import { META, readMetadata, Logger, type IpcHandlerEntry } from '@electrum/common'
import type { DIContainer } from '../di/container'
import type { ScannedModule } from '../module/scanner'
import type { MiddlewarePipeline } from '../middleware/pipeline'

/**
 * 把 Controller 上的 `@IpcHandle` / `@IpcOn` 接到 Electron `ipcMain`。
 *
 * 扫描阶段只收集元数据；真正挂监听在这里：
 *   1. resolve(Controller) —— 属性注入就绪
 *   2. 拼 channel（可选 `prefix:channel`）
 *   3. handle → ipcMain.handle（可返回值，走完整中间件管线）
 *      on     → ipcMain.on（单向消息，只跑 Guard）
 *
 * Application.start 里在 WindowManager 之后调用 `registerAll()`。
 */
export class IpcBridge {
  private logger = new Logger('IpcBridge')
  /** 已注册 channel，用于去重与 `unregisterAll` 时按名拆除 */
  private registeredChannels = new Set<string>()

  constructor(
    private container: DIContainer,
    private scannedModules: ScannedModule[],
    private pipeline: MiddlewarePipeline,
  ) {}

  /** 遍历已扫描模块的 controllers，全部挂到 ipcMain */
  registerAll(): void {
    for (const mod of this.scannedModules) {
      for (const controllerClass of mod.controllers) {
        this.registerController(controllerClass)
      }
    }
    this.logger.log(`Registered ${this.registeredChannels.size} IPC channels`)
  }

  /**
   * 拆除本桥接注册过的全部 IPC 监听，供 Application.shutdown 调用。
   *
   * `registerAll` 会同时挂两类监听：
   *   - `@IpcHandle` → `ipcMain.handle`（invoke/handle，可返回值）
   *   - `@IpcOn`     → `ipcMain.on`（单向消息）
   * 所以这里对每个 channel 两边都卸：
   *   - `removeHandler`     去掉 handle 回调
   *   - `removeAllListeners` 去掉 on 监听
   * 最后清空 `registeredChannels`，避免重复拆除或泄漏登记。
   */
  unregisterAll(): void {
    // 只拆本桥接登记过的 channel，不碰应用里其它地方挂的 ipcMain 监听
    for (const channel of this.registeredChannels) {
      ipcMain.removeHandler(channel) // @IpcHandle → ipcMain.handle
      ipcMain.removeAllListeners(channel) // @IpcOn → ipcMain.on
    }
    this.registeredChannels.clear()
  }

  /**
   * 把单个 Controller 类上的 IPC 装饰器接到 `ipcMain`。
   *
   * 流程：
   *   1. resolve 实例（属性注入、@IpcEmit 等已就绪）
   *   2. 读 `@Controller` 的 prefix，拼完整 channel：`prefix:channel` 或裸 `channel`
   *   3. 遍历 `@IpcHandle` → `ipcMain.handle`（可回传，走完整中间件）
   *   4. 遍历 `@IpcOn`     → `ipcMain.on`（单向，只跑 Guard）
   *
   * 装饰器阶段只写 metadata；真正挂监听在这里。
   */
  private registerController(controllerClass: Function): void {
    // 1. 从 DI 拿 Controller 单例（@Inject / @WindowRef / @IpcEmit 已注入）
    const instance = this.container.resolve(controllerClass)

    // 2. `@Controller('file')` → prefix = 'file'；无前缀则 channel 原样使用
    const controllerMeta = readMetadata<{ prefix: string }>(controllerClass, META.CONTROLLER)
    const prefix = controllerMeta?.prefix || ''

    // ── `@IpcHandle`：渲染进程 ipcRenderer.invoke ↔ 主进程可返回 Promise ──
    const handleMethods = readMetadata<IpcHandlerEntry[]>(controllerClass, META.IPC_HANDLE) || []

    for (const { channel, method, options } of handleMethods) {
      // `@IpcHandle(ch, { devOnly: true })`：非开发环境跳过注册
      if (options?.devOnly && !process.env.NODE_ENV?.includes('dev')) continue

      const fullChannel = prefix ? `${prefix}:${channel}` : channel

      // 全局 channel 去重（跨 Controller 也不能撞名）
      if (this.registeredChannels.has(fullChannel)) {
        this.logger.warn(`Duplicate IPC channel: ${fullChannel}, skipping`)
        continue
      }

      // 闭包捕获 instance / method；真正调用走 MiddlewarePipeline（Guard → Interceptor → 业务方法）
      ipcMain.handle(fullChannel, async (_event, ...args) => {
        return this.pipeline.execute({
          type: 'handle',
          instance,
          method,
          controllerClass,
          channel: fullChannel,
          event: _event,
          args,
        })
      })

      this.registeredChannels.add(fullChannel)
      this.logger.debug(`handle "${fullChannel}" → ${controllerClass.name}.${String(method)}`)
    }

    // ── `@IpcOn`：渲染进程 ipcRenderer.send ↔ 主进程单向收消息，无返回值 ──
    const onMethods = readMetadata<IpcHandlerEntry[]>(controllerClass, META.IPC_ON) || []

    for (const { channel, method } of onMethods) {
      const fullChannel = prefix ? `${prefix}:${channel}` : channel

      if (this.registeredChannels.has(fullChannel)) {
        this.logger.warn(`Duplicate IPC channel: ${fullChannel}, skipping`)
        continue
      }

      // executeGuardOnly：只跑 Guard，不跑 Interceptor；void 忽略 Promise，避免 unhandled rejection 外泄到 EventEmitter
      ipcMain.on(fullChannel, (event, ...args) => {
        void this.pipeline.executeGuardOnly({
          type: 'on',
          instance,
          method,
          controllerClass,
          channel: fullChannel,
          event,
          args,
        })
      })

      this.registeredChannels.add(fullChannel)
      this.logger.debug(`on "${fullChannel}" → ${controllerClass.name}.${String(method)}`)
    }
  }
}
