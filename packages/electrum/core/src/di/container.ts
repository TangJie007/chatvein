import {
  META,
  readMetadata,
  type InjectionPoint,
  type Scope,
} from '@electrum/common'

type Token = Function | string | symbol

interface ProviderRecord {
  token: Token
  useClass?: Function
  useValue?: any
  useFactory?: (...args: any[]) => any
  inject?: Token[]
  scope: Scope
}

type WindowSender = (target: string, channel: string, ...args: any[]) => void

export class DIContainer {
  private singletons = new Map<Token, any>()
  private providers = new Map<Token, ProviderRecord>()
  private resolving = new Set<Token>()
  private windowProvider: (name: string) => any | undefined = () => undefined
  private windowSender: WindowSender = () => undefined

  setWindowProvider(fn: (name: string) => any | undefined): void {
    this.windowProvider = fn
  }

  /** ? @IpcEmit?target ????? `'broadcast'` */
  setWindowSender(fn: WindowSender): void {
    this.windowSender = fn
  }

  register(
    token: Token,
    options: {
      useClass?: Function
      useValue?: any
      useFactory?: (...args: any[]) => any
      inject?: Token[]
      scope?: Scope
    } = {},
  ): void {
    this.providers.set(token, {
      token,
      useClass: options.useClass,
      useValue: options.useValue,
      useFactory: options.useFactory,
      inject: options.inject,
      scope: options.scope || 'singleton',
    })
  }

  /**
   * 从 token 解析实例。支持四类来源：
   * 1. 虚拟 token（如 @WindowRef 注册的 `electrum:window:*`）
   * 2. 已缓存的 singleton
   * 3. Provider（useValue / useFactory / useClass）
   * 4. 直接传 Class 作 token（未显式 register 时按 useClass 处理）
   */
  resolve<T = any>(token: Token): T {
    // @WindowRef('main') 写入的 token 是 Symbol.for('electrum:window:main')，不走 providers 表
    if (typeof token === 'symbol') {
      const tokenStr = token.description || ''
      if (tokenStr.startsWith('electrum:window:')) {
        const windowName = tokenStr.replace('electrum:window:', '')
        const win = this.windowProvider(windowName)
        if (!win) throw new Error(`Window "${windowName}" not found`)
        return win as T
      }
    }

    // singleton 命中则直接返回，避免重复 new / 属性注入
    if (this.singletons.has(token)) {
      return this.singletons.get(token)
    }

    // 正在解析链上再次出现同一 token → 环依赖
    if (this.resolving.has(token)) {
      throw new Error(
        `Circular dependency detected: ${this.formatToken(token)} ` +
          `is being resolved while already in chain: ` +
          `[${[...this.resolving].map((t) => this.formatToken(t)).join(' ? ')}]`,
      )
    }

    const record = this.providers.get(token)

    // useValue：常量 / 配置对象，无构造过程
    if (record && 'useValue' in record && record.useValue !== undefined) {
      if (record.scope === 'singleton') this.singletons.set(token, record.useValue)
      return record.useValue
    }

    // useFactory：先 resolve inject 列表，再调工厂函数
    if (record?.useFactory) {
      const injectTokens = record.inject || []
      const args = injectTokens.map((t) => this.resolve(t))
      const instance = record.useFactory(...args)
      if (record.scope === 'singleton') this.singletons.set(token, instance)
      return instance
    }

    // useClass 或未 register 的 Class token
    const targetClass = record?.useClass || (typeof token === 'function' ? token : null)
    if (!targetClass) {
      throw new Error(`No provider found for token: ${this.formatToken(token)}`)
    }

    this.resolving.add(token)

    try {
      // Stage 3 装饰器无 ctor 注入：先 new，再按 META.INJECTIONS 填属性
      const instance = new (targetClass as any)()
      const injections = readMetadata<InjectionPoint[]>(targetClass, META.INJECTIONS) || []
      const controllerMeta = readMetadata<{ prefix?: string; window?: string }>(
        targetClass,
        META.CONTROLLER,
      )
      const prefix = controllerMeta?.prefix || ''
      const controllerWindow = controllerMeta?.window

      for (const injection of injections) {
        if (injection.type === 'window') {
          // @WindowRef：从 WindowManager 取 BrowserWindow
          const win = this.windowProvider(injection.windowName!)
          if (win) {
            instance[injection.propertyKey] = win
          } else {
            throw new Error(
              `Window "${injection.windowName}" not found for injection in ${targetClass.name}`,
            )
          }
        } else if (injection.type === 'emit') {
          // @IpcEmit：注入一个函数，内部走 windowSender → webContents.send
          const channel = injection.emitChannel || ''
          const fullChannel = prefix ? `${prefix}:${channel}` : channel
          const target = injection.emitWindow ?? controllerWindow ?? 'main'
          instance[injection.propertyKey] = (...args: any[]) => {
            this.windowSender(target, fullChannel, ...args)
          }
        } else if (injection.type === 'optional') {
          // @Optional：token 未注册则跳过，不抛错
          if (this.has(injection.token)) {
            instance[injection.propertyKey] = this.resolve(injection.token)
          }
        } else {
          // @Inject：递归 resolve 依赖的 Provider / Class
          instance[injection.propertyKey] = this.resolve(injection.token)
        }
      }

      const finalScope = record?.scope || 'singleton'
      if (finalScope === 'singleton') {
        this.singletons.set(token, instance)
      }

      return instance
    } finally {
      this.resolving.delete(token)
    }
  }

  has(token: Token): boolean {
    if (typeof token === 'symbol') {
      const desc = token.description || ''
      if (desc.startsWith('electrum:window:')) return true
    }
    return this.providers.has(token) || this.singletons.has(token)
  }

  clear(): void {
    this.singletons.clear()
    this.providers.clear()
    this.resolving.clear()
  }

  private formatToken(token: Token): string {
    if (typeof token === 'function') return token.name || '<anonymous>'
    if (typeof token === 'string') return `"${token}"`
    return String(token)
  }
}
