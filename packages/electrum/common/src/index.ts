import './polyfill'

export { METADATA_READY } from './polyfill'
export { META, readMetadata, getClassMetadata } from './constants/metadata-keys'

export { Module } from './decorators/module.decorator'
export type {
  ModuleMetadata,
  Provider,
  ValueProvider,
  ClassProvider,
  FactoryProvider,
} from './decorators/module.decorator'

export { Injectable } from './decorators/injectable.decorator'
export type { InjectableOptions, Scope } from './decorators/injectable.decorator'

export { Controller } from './decorators/controller.decorator'
export type { ControllerOptions } from './decorators/controller.decorator'
export { IpcHandle, IpcOn } from './decorators/ipc.decorator'
export type { IpcHandlerEntry } from './decorators/ipc.decorator'
export { IpcEmit } from './decorators/ipc-emit.decorator'
export type { IpcEmitOptions } from './decorators/ipc-emit.decorator'

export { AppEvent } from './decorators/app-event.decorator'
export type { AppEventEntry } from './decorators/app-event.decorator'

export { Inject, Optional } from './decorators/inject.decorator'
export type { InjectionPoint } from './decorators/inject.decorator'

export { WindowRef } from './decorators/window-ref.decorator'
export { WindowDeclaration } from './decorators/window.decorator'
export type { WindowOptions } from './decorators/window.decorator'

export {
  UseGuards,
  UsePipes,
  UseInterceptors,
  UseFilters,
} from './decorators/middleware.decorator'
export type { MethodMiddlewareEntry } from './decorators/middleware.decorator'

export type { OnModuleInit, OnAppReady, OnModuleDestroy } from './lifecycle/interfaces'

export type { CanActivate, IpcContext } from './guards/guard.interface'
export type { NestInterceptor } from './interceptors/interceptor.interface'
export type { PipeTransform } from './pipes/pipe.interface'
export type { ExceptionFilter } from './filters/filter.interface'

export {
  ElectronException,
  NotFoundException,
  ForbiddenException,
  ValidationException,
} from './error/base.exception'
export type { IpcErrorResponse } from './error/error-response'

export { Logger } from './logger/logger'
export type { LogLevel } from './logger/logger'
