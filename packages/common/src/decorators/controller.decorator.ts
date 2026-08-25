import { META } from '../constants/metadata-keys'

export interface ControllerOptions {
  prefix?: string
  /** 默认推送目标窗（供 @IpcEmit）；`'broadcast'` 表示所有窗口 */
  window?: string
}

export function Controller(prefixOrOptions: string | ControllerOptions = '') {
  const options: ControllerOptions =
    typeof prefixOrOptions === 'string'
      ? { prefix: prefixOrOptions }
      : {
          prefix: prefixOrOptions.prefix ?? '',
          window: prefixOrOptions.window,
        }

  return (_target: Function, context: ClassDecoratorContext): void => {
    context.metadata![META.CONTROLLER] = {
      prefix: options.prefix ?? '',
      window: options.window,
    }
  }
}
