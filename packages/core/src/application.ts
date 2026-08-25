import { Logger } from '@electrum/common'
import { app as electronApp } from 'electron'
import { DIContainer } from './di/container'
import { ModuleScanner, type ScannedModule } from './module/scanner'
import { MiddlewarePipeline } from './middleware/pipeline'
import { IpcBridge } from './bridge/ipc-bridge'
import { EventBridge } from './bridge/event-bridge'
import { WindowManager } from './window/manager'
import { LifecycleManager } from './lifecycle/manager'
import { TypeGenerator } from './type-generator/generator'
import type { Plugin } from './plugin/plugin.interface'

/**
 * Core 运行时主编排类（框架核心入口）。
 *
 * 职责：持有 DI / 管道 / 窗口等组件，在 start() 中按固定顺序：
 * 扫描模块 → 等 Electron ready → 建窗口 → 绑 IPC/App 事件 → 跑生命周期钩子。
 * 
 */
export class Application {
  /** 全局 DI 容器：注册 Provider、resolve Controller、属性注入 */
  private container = new DIContainer()

  /** 扫描根模块后得到的模块树快照（含 controllers / providers / declarations） */
  private scannedModules: ScannedModule[] = []

  /** IPC 中间件管道：Guard → Pipe → Interceptor → Filter */
  private pipeline = new MiddlewarePipeline(this.container)

  /** 声明式窗口管理，并向 DI 提供 @WindowRef 取值 */
  private windowManager = new WindowManager(this.container)

  /** Controller 方法 → ipcMain.handle / on（start 后才创建） */
  private ipcBridge?: IpcBridge

  /** @AppEvent → electron app.on（start 后才创建） */
  private eventBridge?: EventBridge

  /** onModuleInit / onAppReady / onModuleDestroy */
  private lifecycle?: LifecycleManager

  private plugins: Plugin[] = []
  private logger = new Logger('Application')
  private started = false

  /**
   * @param rootModule 根模块类（须有 @Module），一般是 AppModule
   */
  constructor(private rootModule: Function) {}

  /** 注册插件：立刻调用 install；ready 在 start() 生命周期之后触发 */
  use(plugin: Plugin): this {
    this.plugins.push(plugin)
    plugin.install(this)
    return this
  }

  /** 全局 Filter（IPC Handle 异常时优先业务 Filter，再落到全局） */
  useGlobalFilters(...filters: Function[]): this {
    this.pipeline.useGlobalFilters(...filters)
    return this
  }

  /** 全局 Guard：所有 IPC 通道执行前校验 */
  useGlobalGuards(...guards: Function[]): this {
    this.pipeline.useGlobalGuards(...guards)
    return this 
  }

  /** 全局 Pipe：变换 Handle 的第一个业务参数 */
  useGlobalPipes(...pipes: Function[]): this {
    this.pipeline.useGlobalPipes(...pipes)
    return this
  }

  /** 全局 Interceptor：洋葱模型包裹 Controller 方法 */
  useGlobalInterceptors(...interceptors: Function[]): this {
    this.pipeline.useGlobalInterceptors(...interceptors)
    return this
  }

  /** 手动从容器取实例（调试 / 插件扩展用） */
  resolve<T>(token: Function | string | symbol): T {
    return this.container.resolve<T>(token)
  }

  getWindowManager(): WindowManager {
    return this.windowManager
  }

  getContainer(): DIContainer {
    return this.container
  }

  /**
   * 根据已扫描的 @IpcHandle 生成渲染侧 api.d.ts 骨架。
   * 若尚未 start，会先扫描一次模块（不启动 Electron）。
   */
  generateTypes(outputPath: string): this {
    if (this.scannedModules.length === 0) {
      const scanner = new ModuleScanner(this.container)
      this.scannedModules = scanner.scan(this.rootModule)
    }
    new TypeGenerator(this.scannedModules).generate(outputPath)
    this.logger.log(`Types generated → ${outputPath}`)
    return this
  }

  /**
   * 启动应用（幂等：已启动则直接返回）。
   *
   * 顺序要点：必须先 WindowManager.initialize，再 IpcBridge.registerAll。
   * 因为注册 IPC 时会 resolve Controller，其上可能有 @WindowRef，窗必须已存在。
   */
  async start(): Promise<this> {
    if (this.started) return this

    // 1. 递归扫描 @Module 树，把 providers / controllers 注册进 DI
    const scanner = new ModuleScanner(this.container)
    this.scannedModules = scanner.scan(this.rootModule)

    // 2. 等待 Electron 主进程就绪
    await electronApp.whenReady()

    // 3. 创建声明式窗口，并 setWindowProvider / setWindowSender，供 @WindowRef / @IpcEmit
    await this.windowManager.initialize(this.scannedModules)
    this.container.setWindowSender((target, channel, ...args) => {
      if (target === 'broadcast') this.windowManager.broadcast(channel, ...args)
      else this.windowManager.sendTo(target, channel, ...args)
    })

    // 4. 解析各 Controller，按 prefix:channel 绑定 ipcMain.handle / on
    this.ipcBridge = new IpcBridge(this.container, this.scannedModules, this.pipeline)
    this.ipcBridge.registerAll()

    // 5. 绑定 @AppEvent 到 app.on
    this.eventBridge = new EventBridge(this.container, this.scannedModules)
    this.eventBridge.registerAll()

    // 6. 生命周期：先模块初始化，再应用就绪
    this.lifecycle = new LifecycleManager(this.container, this.scannedModules)
    await this.lifecycle.runHook('onModuleInit')
    await this.lifecycle.runHook('onAppReady')

    // 7. 插件 ready（此时 IPC / 窗口均已可用）
    for (const plugin of this.plugins) {
      await plugin.ready?.(this)
    }

    // 8. 退出时走 shutdown（插件 destroy → onModuleDestroy → 卸 IPC）
    electronApp.on('before-quit', () => {
      void this.shutdown()
    })

    this.started = true
    this.logger.log('Application started')
    return this
  }

  /** 应用退出清理 */
  private async shutdown(): Promise<void> {
    for (const plugin of this.plugins) {
      await plugin.destroy?.(this)
    }
    await this.lifecycle?.runHook('onModuleDestroy')
    this.ipcBridge?.unregisterAll()
  }
}

/**
 * 创建 Application 实例（尚未启动）。
 */
export function createApp(rootModule: Function): Application {
  return new Application(rootModule)
}
