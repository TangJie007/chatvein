import { META } from '../constants/metadata-keys'

/** 实例生命周期：singleton 全局一份；transient 每次 resolve 都 new */
export type Scope = 'singleton' | 'transient'

export interface InjectableOptions {
  scope?: Scope
}

/**
 * 标记类可由 DI 容器管理。本身不创建实例，只写 `META.INJECTABLE`。
 *
 * ModuleScanner 注册类 Provider 时会读这里的 `scope`，再传给 `container.register`。
 * 真正 `new` + 属性注入发生在 `DIContainer.resolve`。
 *
 * @example
 * @Injectable()
 * class FileService {}
 *
 * @Injectable({ scope: 'transient' })
 * class RequestContext {}
 */
export function Injectable(options: InjectableOptions = {}) {
  return (_target: Function, context: ClassDecoratorContext): void => {
    context.metadata![META.INJECTABLE] = {
      isInjectable: true,
      scope: options.scope || 'singleton',
    }
  }
}
