/**
 * Stage 3 装饰器写入 `Symbol.metadata` 时使用的键。
 * 一律用 `Symbol.for`，保证跨包读到同一 identity。
 */
export const META = {
  /** @Module — ModuleMetadata */
  MODULE: Symbol.for('electrum:module'),
  /** @Injectable — { isInjectable, scope } */
  INJECTABLE: Symbol.for('electrum:injectable'),
  /** @Controller — { prefix, window? } */
  CONTROLLER: Symbol.for('electrum:controller'),
  /** @WindowDeclaration — 窗口配置 */
  WINDOW_DECLARATION: Symbol.for('electrum:window_declaration'),

  /** @IpcHandle 方法列表（ipcMain.handle） */
  IPC_HANDLE: Symbol.for('electrum:ipc_handle'),
  /** @IpcOn 方法列表（ipcMain.on） */
  IPC_ON: Symbol.for('electrum:ipc_on'),
  /** @AppEvent 方法列表（app.on） */
  APP_EVENT: Symbol.for('electrum:app_event'),

  /** @Inject / @Optional / @WindowRef 属性注入点列表 */
  INJECTIONS: Symbol.for('electrum:injections'),

  /** 类级 @UseGuards / @UsePipes / @UseInterceptors / @UseFilters */
  CLASS_GUARDS: Symbol.for('electrum:class_guards'),
  CLASS_PIPES: Symbol.for('electrum:class_pipes'),
  CLASS_INTERCEPTORS: Symbol.for('electrum:class_interceptors'),
  CLASS_FILTERS: Symbol.for('electrum:class_filters'),

  /** 方法级中间件（按 method 名归档） */
  METHOD_GUARDS: Symbol.for('electrum:method_guards'),
  METHOD_PIPES: Symbol.for('electrum:method_pipes'),
  METHOD_INTERCEPTORS: Symbol.for('electrum:method_interceptors'),
  METHOD_FILTERS: Symbol.for('electrum:method_filters'),
} as const

export function getClassMetadata(target: Function): Record<PropertyKey, unknown> {
  return ((target as any)[Symbol.metadata] as Record<PropertyKey, unknown>) || {}
}

export function readMetadata<T>(target: Function, key: PropertyKey): T | undefined {
  return getClassMetadata(target)[key] as T | undefined
}
