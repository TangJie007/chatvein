import { META } from '../constants/metadata-keys'

export interface MethodMiddlewareEntry {
  method: string | symbol
  middlewares: Function[]
}

function createMiddlewareDecorator(classKey: symbol, methodKey: symbol) {
  return (...middlewares: Function[]) => {
    return function (
      _target: Function | object,
      context: ClassDecoratorContext | ClassMethodDecoratorContext,
    ): void {
      if (context.kind === 'class') {
        const existing = (context.metadata![classKey] as Function[]) || []
        context.metadata![classKey] = [...middlewares, ...existing]
      } else {
        const entries = (context.metadata![methodKey] as MethodMiddlewareEntry[]) || []
        const existing = entries.find((e) => e.method === context.name)
        if (existing) {
          existing.middlewares = [...middlewares, ...existing.middlewares]
        } else {
          entries.push({ method: context.name, middlewares: [...middlewares] })
        }
        context.metadata![methodKey] = entries
      }
    }
  }
}

export const UseGuards = createMiddlewareDecorator(META.CLASS_GUARDS, META.METHOD_GUARDS)
export const UsePipes = createMiddlewareDecorator(META.CLASS_PIPES, META.METHOD_PIPES)
export const UseInterceptors = createMiddlewareDecorator(
  META.CLASS_INTERCEPTORS,
  META.METHOD_INTERCEPTORS,
)
export const UseFilters = createMiddlewareDecorator(META.CLASS_FILTERS, META.METHOD_FILTERS)
