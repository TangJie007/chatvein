import type { IpcMainEvent, IpcMainInvokeEvent } from 'electron'

export interface IpcContext {
  channel: string
  event: IpcMainInvokeEvent | IpcMainEvent
  args: any[]
  controllerClass: Function
  instance: any
}

export interface CanActivate {
  canActivate(context: IpcContext): boolean | Promise<boolean>
}
