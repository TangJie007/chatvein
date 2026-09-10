# Electrum

NestJS 风格的 Electron 主进程框架：用**装饰器**声明模块、依赖注入、IPC 通道、窗口与生命周期，让 Electron 应用拥有和 Nest 一样规整的分层结构。

- **零反射**：基于 TypeScript 5 的 **Stage 3 装饰器** + `Symbol.metadata`，不依赖 `reflect-metadata`、不需要 `experimentalDecorators`。
- **主进程即服务端**：`@Controller` + `@IpcHandle` 直接映射到 `ipcMain.handle`，渲染进程用类型化客户端调用。
- **内置全套中间件**：Guard / Pipe / Interceptor / Filter，全局 + 类级 + 方法级。
- **声明式窗口**：`@WindowDeclaration` 声明窗口，`@WindowRef` 注入实例，`@IpcEmit` 反向推送。
- **端到端类型安全**：`@electrum/codegen` 从主进程 Controller 扫描并生成渲染端 `IpcApi` 类型与 preload 脚本。

---

## 目录

- [包结构](#包结构)
- [安装与环境要求](#安装与环境要求)
- [快速开始](#快速开始)
- [核心用法](#核心用法)
  - [模块与依赖注入](#模块与依赖注入)
  - [Controller 与 IPC](#controller-与-ipc)
  - [属性注入](#属性注入)
  - [窗口](#窗口)
  - [应用事件](#应用事件)
  - [生命周期钩子](#生命周期钩子)
  - [中间件：Guard / Pipe / Interceptor / Filter](#中间件guard--pipe--interceptor--filter)
  - [异常处理](#异常处理)
  - [日志](#日志)
  - [插件](#插件)
- [渲染进程：类型化 IPC 客户端](#渲染进程类型化-ipc-客户端)
- [Preload](#preload)
- [代码生成：@electrum/codegen](#代码生成electrumcodegen)
- [测试](#测试)
- [API 速查](#api-速查)

---

## 包结构

`electrum` 是一个多包（monorepo）目录，按职责拆分：

| 包名 | 说明 |
| --- | --- |
| `@electrum/common` | 装饰器、接口、异常、日志等共享基础能力（业务代码主要从这里导入装饰器） |
| `@electrum/core` | 运行时：DI 容器、模块扫描、IPC 桥、窗口管理、生命周期、应用启动 |
| `@electrum/preload` | preload 侧 `contextBridge` 封装（`exposeApi`、`IpcError`） |
| `@electrum/client` | 渲染进程侧的类型化 IPC 客户端（`createClient`） |
| `@electrum/codegen` | 从主进程源码生成 `IpcApi` 类型声明与 preload 脚本（CLI + 编程 API） |
| `@electrum/testing` | 测试工具：Electron mock、测试用 DI 容器 |

依赖关系（运行时）：`core → common`；`testing → core, common`；其余互相独立。

---

## 安装与环境要求

```bash
# pnpm（本仓库为 workspace 结构）
pnpm add @electrum/core @electrum/common @electrum/preload

# 渲染进程需要类型化客户端时
pnpm add @electrum/client

# 开发期需要代码生成时
pnpm add -D @electrum/codegen
```

环境要求：

- **TypeScript >= 5.2**（Stage 3 装饰器 + `Symbol.metadata`）
- **Electron >= 20**（`core` / `preload` 的 peerDependency）

`tsconfig.json` 关键配置：

```jsonc
{
  "compilerOptions": {
    "target": "ES2022",        // 必须 >= ES2022，才能启用 Stage 3 装饰器与 context.metadata
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true
    // 不要开启 "experimentalDecorators"（那是旧版装饰器，Electrum 用的是 Stage 3）
  }
}
```

> 关于 `Symbol.metadata` 的 polyfill：只要引入了 `@electrum/common`，它会自动执行 `import './polyfill'` 注册 `Symbol.metadata`，因此**必须确保装饰器定义前已加载 `@electrum/common`**。`@electrum/core` 的入口也已 `import '@electrum/common'`。

---

## 快速开始

一个最小可运行的应用由五部分组成：**窗口声明 → 服务 → 控制器 → 模块 → 启动**，前端再加 **preload → client**。

```
src/
├─ main/
│  ├─ index.ts          # bootstrap：createApp + start
│  ├─ app.module.ts     # 根模块
│  ├─ app.controller.ts # IPC 控制器
│  ├─ app.service.ts    # 业务服务
│  └─ window.module.ts  # 窗口声明 + 窗口控制器
├─ preload/
│  └─ index.ts          # exposeApi()
└─ renderer/
   └─ ...               # createClient<IpcApi>()
```

**1) 声明窗口**（`main/window.module.ts`）

```ts
import { join } from 'node:path'
import { Module, WindowDeclaration } from '@electrum/common'
import { WindowController } from './window.controller'
import { WindowService } from './window.service'

@WindowDeclaration({
  name: 'main',
  options: {
    width: 1180,
    height: 760,
    show: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  },
  prodFile: join(__dirname, '../renderer/index.html'), // 生产环境加载；开发环境自动用 ELECTRON_RENDERER_URL
})
export class MainWindow {}

@Module({
  declarations: [MainWindow],
  controllers: [WindowController],
  providers: [WindowService],
})
export class WindowModule {}
```

**2) 写服务**（`main/app.service.ts`）

```ts
import { Injectable, Logger, type OnAppReady } from '@electrum/common'

@Injectable()
export class AppService implements OnAppReady {
  private logger = new Logger('AppService')

  onAppReady(): void {
    this.logger.log('app ready')
  }

  greet(name: string): string {
    return `Hello, ${name}!`
  }
}
```

**3) 写控制器**（`main/app.controller.ts`）

```ts
import { app } from 'electron'
import { Controller, IpcHandle, AppEvent, Inject } from '@electrum/common'
import { AppService } from './app.service'

@Controller('app') // 通道前缀，最终通道为 app:<channel>
export class AppController {
  @Inject(AppService)
  appService!: AppService

  @IpcHandle('ping') // → 渲染进程 invoke('app:ping', msg)
  ping(message: string): { echo: string; at: number } {
    return { echo: this.appService.greet(message), at: Date.now() }
  }

  @AppEvent('window-all-closed')
  onAllClosed(): void {
    if (process.platform !== 'darwin') app.quit()
  }
}
```

**4) 组装模块**（`main/app.module.ts`）

```ts
import { Module } from '@electrum/common'
import { AppController } from './app.controller'
import { AppService } from './app.service'
import { WindowModule } from './window.module'

@Module({
  imports: [WindowModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
```

**5) 启动**（`main/index.ts`）

```ts
import { createApp } from '@electrum/core'
import { AppModule } from './app.module'

async function bootstrap(): Promise<void> {
  const app = createApp(AppModule)
  await app.start()
}

bootstrap().catch((err) => {
  console.error('[bootstrap] failed:', err)
  process.exit(1)
})
```

**6) Preload**（`preload/index.ts`）

```ts
import { exposeApi } from '@electrum/preload'

exposeApi() // 挂载 window.api = { invoke, on, send }
```

**7) 渲染进程调用**

```ts
import { createClient } from '@electrum/client'
import type { IpcApi } from './api/ipc-api' // 由 codegen 生成

const api = createClient<IpcApi>()

const res = await api.app.ping('world') // → invoke('app:ping', 'world') → { echo: 'Hello, world!', at: ... }
```

---

## 核心用法

### 模块与依赖注入

`@Module` 声明一个模块，`Application.start()` 会从根模块出发深度优先扫描 `imports` 树，并**边扫边注册** Provider 与 Controller。

```ts
@Module({
  imports: [],          // 子模块（先于本模块注册）
  controllers: [],      // @Controller，会注册进 DI 供 IpcBridge resolve
  providers: [],        // 可注入 Provider
  declarations: [],     // @WindowDeclaration 窗口声明类
})
export class AppModule {}
```

**Provider 的四种形态**（与 Nest 一致）：

```ts
@Module({
  providers: [
    // 1. 类：直接注册，scope 取 @Injectable 的配置
    AppService,

    // 2. useValue：常量 / 配置对象（token 建议用 string/symbol）
    { provide: 'APP_CONFIG', useValue: { apiBase: 'https://...' } },

    // 3. useClass：把 token 映射到另一个类
    { provide: 'STORAGE', useClass: SqliteStorage },

    // 4. useFactory：工厂函数 + 依赖注入
    {
      provide: 'DB',
      useFactory: (config: AppConfig) => createDb(config),
      inject: ['APP_CONFIG'],
    },
  ],
})
export class AppModule {}
```

**实例作用域**：

```ts
@Injectable()                          // 默认 singleton：整个生命周期一份
class CacheService {}

@Injectable({ scope: 'transient' })    // transient：每次 resolve 都新建
class RequestContext {}
```

**注入依赖**（Stage 3 无参数装饰器，因此只支持**属性注入**，不支持构造函数注入）：

```ts
@Injectable()
class UserService {
  @Inject(AppService) appService!: AppService      // 按类 token
  @Inject('APP_CONFIG') config!: AppConfig          // 按 string/symbol token
  @Inject(OptionalLogger) @Optional() logger?: OptionalLogger // 未注册也不报错（@Optional 需紧跟 @Inject）
}
```

> token 未注册时会抛错；若依赖可能缺失，请用 `@Optional()`（写在 `@Inject()` **之后**，作用于同一字段）。

**手动从容器取实例**：

```ts
const app = createApp(AppModule)
await app.start()
const svc = app.resolve<AppService>(AppService)
```

---

### Controller 与 IPC

`@Controller` 标记 IPC 入口类，配合方法装饰器把方法绑到 `ipcMain`：

```ts
@Controller('file') // 前缀；通道最终为 file:<channel>
export class FileController {
  @IpcHandle('read')                     // ipcMain.handle → 可 Promise 返回，走完整中间件
  async read(path: string): Promise<string> {
    return fs.readFile(path, 'utf8')
  }

  @IpcHandle('debug-dump', { devOnly: true }) // 仅开发环境注册
  dump(): unknown {
    return process.env
  }

  @IpcOn('log')                          // ipcMain.on → 单向消息，无返回值，只跑 Guard
  onLog(event: Electron.IpcMainEvent, line: string): void {
    console.log(line)
  }
}
```

- **通道拼接规则**：`prefix ? \`${prefix}:${channel}\` : channel`。
- `@IpcHandle` 走完整管线 `Guard → Pipe → Interceptor → 业务方法`，异常由 Filter 处理并以 `{ __error }` 返回。
- `@IpcOn` 只跑 Guard，然后调用 `instance[method](event, ...args)`；无返回值。
- 跨 Controller 的**通道名全局去重**，重复注册会被跳过并告警。

**主进程 → 渲染进程推送**：`@IpcEmit` 注入「调用即推送」的函数。

```ts
@Controller('task', { window: 'main' }) // 可指定默认目标窗
export class TaskController {
  @IpcEmit('progress')            // 通道 task:progress，目标窗取 Controller.window → 'main'
  emitProgress!: (pct: number) => void

  @IpcEmit('done', { window: 'broadcast' }) // 'broadcast' 表示推给所有窗口
  emitDone!: (result: unknown) => void

  @IpcHandle('run')
  run(): void {
    this.emitProgress(50)
    this.emitDone({ ok: true })
  }
}
```

目标窗解析顺序：`@IpcEmit` 的 `window` → `@Controller` 的 `window` → `'main'`。渲染端用 `client.on('task:progress', cb)` 订阅。

---

### 属性注入

| 装饰器 | 作用 |
| --- | --- |
| `@Inject(token)` | 按 token resolve 并注入 Provider 实例 |
| `@Optional()` | 标在 `@Inject()` 之后，token 缺失时跳过、不抛错 |
| `@WindowRef(name = 'main')` | 注入对应名称的 `BrowserWindow` 实例 |
| `@IpcEmit(channel, opts?)` | 注入一个「调用即向渲染进程发送」的函数 |

```ts
@Controller('window')
export class WindowController {
  @WindowRef('main') private win?: BrowserWindow

  @IpcHandle('minimize')
  minimize(): void {
    this.win?.minimize()
  }
}
```

> 窗口必须先于 IPC 注册（`Application.start` 已保证顺序），否则 `@WindowRef` 会因找不到窗口而抛错。

---

### 窗口

`@WindowDeclaration` 声明窗口配置，`WindowManager` 在 Electron ready 后自动创建（除非 `autoCreate: false`）。

```ts
@WindowDeclaration({
  name: 'main',
  options: { width: 1180, height: 760, show: false },  // BrowserWindowConstructorOptions
  devUrl: 'http://localhost:5173',                       // 可选：开发环境 URL
  prodFile: join(__dirname, '../renderer/index.html'),   // 生产环境文件
  autoCreate: true,                                      // 默认 true
})
export class MainWindow {}
```

开发/生产判定：存在 `ELECTRON_RENDERER_URL` 或 `NODE_ENV` 含 `dev` 时走 `devUrl`，否则 `loadFile(prodFile)`。设置 `ELECTRON_OPEN_DEVTOOLS=1` 会自动打开 DevTools。

通过 `app.getWindowManager()` 获得手动控制能力：

```ts
const wm = app.getWindowManager()
wm.getWindow('main')                       // 取窗口
wm.getAllWindows()                          // 全部窗口
wm.sendTo('main', 'app:notice', 'hi')       // 定向推送
wm.broadcast('app:notice', 'hi')            // 广播
wm.createWindow({ name: 'settings', options: { width: 600, height: 400 } }) // 动态建窗
```

---

### 应用事件

用 `@AppEvent` 把方法绑到 Electron `app.on(...)`，可写在 Controller 或 Provider 上：

```ts
@Injectable()
export class LifecycleHooks {
  @AppEvent('ready')
  onReady(): void {}

  @AppEvent('window-all-closed')
  onAllClosed(): void {
    if (process.platform !== 'darwin') app.quit()
  }

  @AppEvent('activate')
  onActivate(): void {}
}
```

支持的事件名由 `AppEventName` 类型收窄（如 `ready`、`activate`、`window-all-closed`、`before-quit`、`second-instance` 等）。特殊处理：若注册 `ready` 时 `app.isReady()` 已为 `true`，会补发一次调用。

---

### 生命周期钩子

在服务/控制器上实现以下接口即可，框架按固定顺序调用：

```ts
export interface OnModuleInit   { onModuleInit(): void | Promise<void> }
export interface OnAppReady     { onAppReady(): void | Promise<void> }
export interface OnModuleDestroy{ onModuleDestroy(): void | Promise<void> }
```

**启动顺序**（`Application.start`）：

1. 扫描 `@Module` 树，注册 Provider / Controller
2. `app.whenReady()`
3. 创建声明窗口（`WindowManager`）
4. 注册 IPC（`@IpcHandle` / `@IpcOn`）
5. 绑定 `@AppEvent`
6. `onModuleInit` → `onAppReady`
7. 插件 `ready()`

**退出顺序**（`before-quit`）：

1. 插件 `destroy()`
2. `onModuleDestroy`
3. 卸载 IPC 与 app 事件监听

> 钩子异常不会中断应用，`LifecycleManager` 只记录错误日志。

---

### 中间件：Guard / Pipe / Interceptor / Filter

执行顺序：

```
Guard → Pipe → Interceptor(洋葱) → Controller 方法 → 返回值
                 └─ 任一步抛错 → Filter → { __error: true, ... }
```

（`@IpcOn` 只跑 Guard，不跑 Pipe / Interceptor。）

**接口定义**：

```ts
interface CanActivate   { canActivate(ctx: IpcContext): boolean | Promise<boolean> }
interface PipeTransform { transform(value: any, ctx: IpcContext): any | Promise<any> } // 只变换第一个业务参数
interface NestInterceptor { intercept(ctx: IpcContext, next: () => Promise<any>): Promise<any> }
interface ExceptionFilter { catch(ex: unknown, ctx: IpcContext): IpcErrorResponse }

interface IpcContext {
  channel: string
  event: Electron.IpcMainInvokeEvent | Electron.IpcMainEvent
  args: any[]
  controllerClass: Function
  instance: any
}
```

**示例**：

```ts
@Injectable()
export class AuthGuard implements CanActivate {
  canActivate(ctx: IpcContext): boolean {
    return !!ctx.event.sender
  }
}

@Injectable()
export class TrimPipe implements PipeTransform {
  transform(value: string): string {
    return typeof value === 'string' ? value.trim() : value
  }
}

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  async intercept(ctx: IpcContext, next: () => Promise<any>) {
    const t = Date.now()
    const r = await next()
    console.log(`${ctx.channel} took ${Date.now() - t}ms`)
    return r
  }
}

@Injectable()
export class AppFilter implements ExceptionFilter {
  catch(ex: unknown, ctx: IpcContext) {
    return { __error: true, code: 'APP', message: `[${ctx.channel}] ${(ex as Error).message}` }
  }
}
```

**挂载方式**：

```ts
// 类级：本 Controller 所有通道
@UseGuards(AuthGuard)
@Controller('file')
export class FileController {
  // 方法级：仅本方法
  @UsePipes(TrimPipe)
  @UseInterceptors(LoggingInterceptor)
  @IpcHandle('read')
  read(path: string) { /* ... */ }
}
```

```ts
// 全局：对所有 IPC 生效
const app = createApp(AppModule)
app.useGlobalGuards(AuthGuard)
app.useGlobalPipes(TrimPipe)
app.useGlobalInterceptors(LoggingInterceptor)
app.useGlobalFilters(AppFilter)
await app.start()
```

Filter 查找优先级：方法级 → 类级 → 全局；都没有时，`ElectronException` 用 `toJSON()`，普通 `Error` 归为 `INTERNAL`。

---

### 异常处理

内置异常均继承 `ElectronException`，序列化为 `IpcErrorResponse` 返回渲染进程：

```ts
import { NotFoundException, ForbiddenException, ValidationException, ElectronException } from '@electrum/common'

throw new NotFoundException('User')                      // code=NOT_FOUND, statusCode=404
throw new ForbiddenException('no permission')            // code=FORBIDDEN, statusCode=403
throw new ValidationException('invalid', [/* errors */]) // code=VALIDATION_ERROR, statusCode=422
throw new ElectronException('boom', 'MY_CODE', 500, { x: 1 }) // 自定义
```

响应结构：

```ts
interface IpcErrorResponse {
  __error: true
  code: string
  message: string
  details?: unknown
  stack?: string // 仅 NODE_ENV 含 dev 时返回
}
```

---

### 日志

```ts
import { Logger } from '@electrum/common'

const logger = new Logger('MyService')
logger.debug('...')   // 受全局等级控制
logger.log('...')
logger.warn('...')
logger.error('...')

Logger.setLevel('warn') // 全局等级：debug < verbose < log < warn < error
```

---

### 插件

插件用于封装可复用的启动逻辑（如 MCP 宿主、数据库连接）：

```ts
import type { Plugin } from '@electrum/core'

const myPlugin: Plugin = {
  name: 'my-plugin',
  install(app) {
    // start() 之前立即调用；可 app.useGlobalGuards(...) 等
  },
  async ready(app) {
    // 窗口 / IPC 都就绪后调用
  },
  async destroy(app) {
    // 退出时清理
  },
}

const app = createApp(AppModule)
app.use(myPlugin)
await app.start()
```

---

## 渲染进程：类型化 IPC 客户端

`@electrum/client` 提供基于 `window.api` 的客户端，配合 codegen 生成的 `IpcApi` 类型即可获得完整类型推断（含命名空间）。

```ts
import { createClient } from '@electrum/client'
import type { IpcApi } from './api/ipc-api'

const api = createClient<IpcApi>()

// 命名空间调用：client.<prefix>.<method>() → invoke('<prefix>:<method>')
const text = await api.file.read('/tmp/a.txt')
const pong = await api.app.ping('hi')

// 直接按通道调用
await api.invoke('app:ping', 'hi')

// 订阅主进程推送，返回取消订阅函数
const off = api.on('task:progress', (pct: number) => console.log(pct))
off()

// 单向发送（对应主进程 @IpcOn）
api.send('log', 'a line')
```

**手动注入桥**（测试或自定义 window key 时）：

```ts
const api = createClient<IpcApi>({
  key: 'api',                 // window 上的键，默认 'api'
  bridge: customBridge,       // { invoke, on, send }
})
```

若未调用 `exposeApi()`，客户端会抛出明确错误提示。

---

## Preload

```ts
import { exposeApi } from '@electrum/preload'

const api = exposeApi({ key: 'api' }) // 默认 'api' → window.api
```

- `invoke`：自动识别主进程返回的 `{ __error }` 并抛出 `IpcError`。
- `on` / `send`：事件通道。
- **幂等**：开发期 preload 热重载重复执行时，会吞掉「重复 expose」的错误，保留已有 `window.api`。

```ts
import { IpcError, isIpcErrorPayload } from '@electrum/preload'

try {
  await window.api.invoke('file:read', '/x')
} catch (e) {
  if (e instanceof IpcError) console.error(e.code, e.message, e.details)
}
```

也可以继续用原生 API 暴露额外能力：

```ts
import { exposeApi } from '@electrum/preload'
import { contextBridge, webUtils } from 'electron'

exposeApi()
contextBridge.exposeInMainWorld('fileApi', {
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
})
```

---

## 代码生成：@electrum/codegen

扫描主进程源码里的 `@Controller` + `@IpcHandle`，生成：

1. **渲染端 `IpcApi` 类型声明**（每个通道的入参 / 返回类型）。
2. **可选 preload 脚本**：调用 `exposeApi()` 并导出通道白名单。

**CLI**：

```bash
# 生成 IpcApi 声明
electrum-codegen --tsconfig tsconfig.json --output src/renderer/api/ipc-api.ts

# 同时生成 preload 脚本
electrum-codegen --tsconfig tsconfig.json \
  --output src/renderer/api/ipc-api.ts \
  --preload src/preload/index.ts

# 其它选项
#   --include <glob>   源码范围（可重复，默认项目内全部 .ts）
#   --no-dev-only      排除 @IpcHandle({ devOnly: true }) 的通道
#   --global           额外生成 Window.api 全局声明
```

生成物示例：

```ts
// AUTO-GENERATED — DO NOT EDIT
export interface IpcApi {
  /** IPC: app:ping (AppController.ping) */
  'app:ping': (message: string) => { echo: string; at: number }

  /** IPC: file:read (FileController.read) */
  'file:read': (path: string) => Promise<string>
}
```

**编程 API**：

```ts
import { generateIpcTypes } from '@electrum/codegen'

await generateIpcTypes({
  tsconfig: 'tsconfig.json',
  outputPath: 'src/renderer/api/ipc-api.ts',
  preloadOutputPath: 'src/preload/index.ts',
  includeGlobal: true,
})
```

建议在 `package.json` 里加脚本，在启动前生成：

```jsonc
{
  "scripts": {
    "codegen": "electrum-codegen --tsconfig tsconfig.json --output src/renderer/api/ipc-api.ts --preload src/preload/index.ts",
    "dev": "npm run codegen && electron-vite dev"
  }
}
```

> `devOnly` 通道默认在**非 production** 环境包含；`NODE_ENV=production` 时自动排除。

---

## 测试

`@electrum/testing` 提供不启动 Electron 的测试能力。

**Mock Electron**（配合 Vitest）：

```ts
import { vi, expect, test } from 'vitest'
import { mockElectron } from '@electrum/testing'

const electron = mockElectron()
vi.mock('electron', () => electron)

// 之后可读取注册的通道、模拟调用
electron.ipcMain.handleChannels()          // ['app:ping']
await electron.ipcMain.invoke('app:ping', 'hi')
electron.ipcMain.emit('log', 'line')        // 触发 @IpcOn
electron.BrowserWindow.instances            // mock 出来的窗口
electron.reset()                            // 每个用例前清空
```

**测试用 DI 容器**：

```ts
import { createTestContainer } from '@electrum/testing'

const container = createTestContainer()
const ctx = container.getContainer()

ctx.register(Logger, { useValue: fakeLogger })
ctx.register('APP_CONFIG', { useValue: { apiBase: 'x' } })

// 或直接 mock
container.mock(AppService, { greet: () => 'hi' })
const svc = container.resolve<AppService>(AppService)
```

---

## API 速查

**`@electrum/common`**

- 模块 / DI：`Module`、`Injectable`、`Inject`、`Optional`
- IPC：`Controller`、`IpcHandle`、`IpcOn`、`IpcEmit`
- 窗口：`WindowDeclaration`、`WindowRef`
- 事件 / 钩子：`AppEvent`、`OnModuleInit`、`OnAppReady`、`OnModuleDestroy`
- 中间件：`UseGuards`、`UsePipes`、`UseInterceptors`、`UseFilters` + `CanActivate` / `PipeTransform` / `NestInterceptor` / `ExceptionFilter` / `IpcContext`
- 异常：`ElectronException`、`NotFoundException`、`ForbiddenException`、`ValidationException`、`IpcErrorResponse`
- 其它：`Logger`、`LogLevel`、`META`、`readMetadata`、`getClassMetadata`

**`@electrum/core`**

- `createApp(rootModule)` → `Application`
- `Application`：`start()`、`use(plugin)`、`useGlobalGuards/Pipes/Interceptors/Filters()`、`resolve(token)`、`getWindowManager()`、`getContainer()`
- `WindowManager`：`getWindow()`、`getAllWindows()`、`sendTo()`、`broadcast()`、`createWindow()`
- 底层类：`DIContainer`、`ModuleScanner`、`IpcBridge`、`EventBridge`、`MiddlewarePipeline`、`LifecycleManager`

**`@electrum/preload`**：`exposeApi()`、`IpcError`、`isIpcErrorPayload()`、`ElectrumApi`

**`@electrum/client`**：`createClient<IpcApi>()`、`ElectrumClient`、`ElectrumBridge`

**`@electrum/codegen`**：`generateIpcTypes()`、`buildIpcApiDeclaration()`、`buildPreloadScript()`、`scanIpcChannels()`、`createProject()`

**`@electrum/testing`**：`mockElectron()`、`MockBrowserWindow`、`TestContainer`、`createTestContainer()`

---

## License

MIT
