import { META } from '../constants/metadata-keys'

/**
 * Electron `app.on(...)` 支持的事件名（对齐 electron@44 `App` 接口重载）。
 * 未列入的字符串在类型层会被拒绝；运行时仍由 EventBridge 原样转给 `app.on`。
 */
export type AppEventName =
  | 'accessibility-support-changed'
  | 'activate'
  | 'activity-was-continued'
  | 'before-quit'
  | 'browser-window-blur'
  | 'browser-window-created'
  | 'browser-window-focus'
  | 'certificate-error'
  | 'child-process-gone'
  | 'continue-activity'
  | 'continue-activity-error'
  | 'did-become-active'
  | 'did-resign-active'
  | 'gpu-info-update'
  | 'login'
  | 'new-window-for-tab'
  | 'open-file'
  | 'open-url'
  | 'quit'
  | 'ready'
  | 'render-process-gone'
  | 'second-instance'
  | 'select-client-certificate'
  | 'session-created'
  | 'update-activity-state'
  | 'web-contents-created'
  | 'will-continue-activity'
  | 'will-finish-launching'
  | 'will-quit'
  | 'window-all-closed'

export interface AppEventEntry {
  event: AppEventName
  method: string | symbol
}

export function AppEvent(eventName: AppEventName) {
  return (_method: Function, context: ClassMethodDecoratorContext): void => {
    const handlers = (context.metadata![META.APP_EVENT] as AppEventEntry[]) || []
    handlers.push({ event: eventName, method: context.name })
    context.metadata![META.APP_EVENT] = handlers
  }
}
