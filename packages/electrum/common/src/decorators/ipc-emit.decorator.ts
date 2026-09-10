import { META } from '../constants/metadata-keys'
import type { InjectionPoint } from './inject.decorator'

export interface IpcEmitOptions {
  /** 覆盖 Controller 默认 window；`'broadcast'` 表示所有窗口 */
  window?: string
}

/**
 * 属性注入：调用字段函数即向渲染进程推送（主进程 → 渲染进程）。
 *
 * 通道名 = Controller prefix + channel（与 @IpcHandle 相同规则）。
 * 目标窗 = options.window → Controller.window → `'main'`。
 */
export function IpcEmit(channel: string, options?: IpcEmitOptions) {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const injections = (context.metadata![META.INJECTIONS] as InjectionPoint[]) || []
    injections.push({
      propertyKey: context.name,
      token: null,
      type: 'emit',
      emitChannel: channel,
      emitWindow: options?.window,
    })
    context.metadata![META.INJECTIONS] = injections
  }
}
