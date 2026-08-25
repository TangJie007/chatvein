import { META } from '../constants/metadata-keys'
import type { BrowserWindowConstructorOptions } from 'electron'

export interface WindowOptions {
  name: string
  options?: BrowserWindowConstructorOptions
  devUrl?: string
  prodFile?: string
  autoCreate?: boolean
}

export function WindowDeclaration(config: WindowOptions) {
  return (_target: Function, context: ClassDecoratorContext): void => {
    context.metadata![META.WINDOW_DECLARATION] = config
  }
}
