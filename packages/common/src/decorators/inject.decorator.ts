import { META } from '../constants/metadata-keys'

/**
 * 属性注入点描述（写入 `META.INJECTIONS`）。
 * 装饰器只登记；真正赋值在 `DIContainer.resolve` 里按 `type` 分支处理。
 *
 * 由 `@Inject` / `@Optional` / `@WindowRef` / `@IpcEmit` 共同写入同一份列表。
 */
export interface InjectionPoint {
  /** 被注入的实例字段名 */
  propertyKey: string | symbol
  /** resolve 用的 token（类 / 字符串 / symbol）；`window`/`emit` 类可不依赖此字段 */
  token: any
  /**
   * 注入种类：
   * - `service` — `@Inject`，按 token resolve Provider
   * - `window` — `@WindowRef`，注入 BrowserWindow
   * - `optional` — `@Optional`，缺失时不抛错
   * - `emit` — `@IpcEmit`，注入「调用即推送到渲染进程」的函数
   */
  type: 'service' | 'window' | 'optional' | 'emit'
  /** `@WindowRef(name)` 对应的窗口名 */
  windowName?: string
  /** 是否可选依赖（与 `type: 'optional'` 配套） */
  optional?: boolean
  /** @IpcEmit 通道名（不含 Controller 前缀） */
  emitChannel?: string
  /** @IpcEmit 目标窗；覆盖 Controller.window */
  emitWindow?: string
}

/**
 * 字段注入：声明「该属性需要容器按 `token` resolve 出的实例」。
 *
 * Stage 3 无参数装饰器，用属性注入替代构造函数 `@Inject`。
 * 本身不取值，只往 `META.INJECTIONS` 推一条 `type: 'service'`。
 *
 * @example
 * @Inject(FileService)
 * fileService!: FileService
 *
 * @Inject('APP_CONFIG')
 * config!: AppConfig
 */
export function Inject(token: any) {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const injections = (context.metadata![META.INJECTIONS] as InjectionPoint[]) || []
    injections.push({
      propertyKey: context.name,
      token,
      type: 'service',
    })
    context.metadata![META.INJECTIONS] = injections
  }
}

/**
 * 将**同一字段上**紧邻的上一条注入标为可选。
 *
 * resolve 时若 token 未注册则跳过赋值、不抛错（需写在 `@Inject` 之后）。
 *
 * @example
 * @Inject(OptionalLogger)
 * @Optional()
 * logger?: OptionalLogger
 */
export function Optional() {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const injections = (context.metadata![META.INJECTIONS] as InjectionPoint[]) || []
    const last = injections[injections.length - 1]
    if (last && last.propertyKey === context.name) {
      last.type = 'optional'
      last.optional = true
    }
    context.metadata![META.INJECTIONS] = injections
  }
}
