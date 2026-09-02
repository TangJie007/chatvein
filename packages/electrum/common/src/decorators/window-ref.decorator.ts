import { META } from '../constants/metadata-keys'
import type { InjectionPoint } from './inject.decorator'

export function WindowRef(name = 'main') {
  return (_value: undefined, context: ClassFieldDecoratorContext): void => {
    const injections = (context.metadata![META.INJECTIONS] as InjectionPoint[]) || []
    injections.push({
      propertyKey: context.name,
      token: Symbol.for(`electrum:window:${name}`),
      type: 'window',
      windowName: name,
    })
    context.metadata![META.INJECTIONS] = injections
  }
}
