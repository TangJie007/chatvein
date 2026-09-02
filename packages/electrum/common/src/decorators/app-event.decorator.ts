import { META } from '../constants/metadata-keys'

export interface AppEventEntry {
  event: string
  method: string | symbol
}

export function AppEvent(eventName: string) {
  return (_method: Function, context: ClassMethodDecoratorContext): void => {
    const handlers = (context.metadata![META.APP_EVENT] as AppEventEntry[]) || []
    handlers.push({ event: eventName, method: context.name })
    context.metadata![META.APP_EVENT] = handlers
  }
}
