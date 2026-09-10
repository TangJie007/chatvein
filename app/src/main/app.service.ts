import { join } from 'node:path'
import { app } from 'electron'
import {
  Inject,
  Injectable,
  Logger,
  type OnAppReady,
  type OnModuleDestroy,
} from '@electrum/common'

/**
 * harness 宿主：把 `@chatvein/harness` 的生命周期挂到 Electrum 的模块生命周期上。
 *
 * - `onAppReady`：Electron 已 ready、窗口与 IPC 通道都注册完之后才启动 harness，
 *   避免插件在窗口就绪前就往渲染端推事件。
 * - `onModuleDestroy`：`before-quit` 时由框架调用，递归卸载全部插件——
 *   MCP 子进程、沙箱容器、SSE 连接、定时器都随各自的 `ctx.effect()` 撤销。
 *
 * 启动失败不会拖垮应用：LifecycleManager 对钩子异常只记日志。
 *
 * Agent 不在此挂载：`@chatvein/agents` 是工厂包；编排由 `conversationRuntimePlugin`
 * 内部调用 createRouter / createToolsFilter / createChatAgent。
 */
@Injectable()
export class AppService implements OnAppReady, OnModuleDestroy {

}
