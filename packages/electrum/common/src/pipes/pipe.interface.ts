import type { IpcContext } from '../guards/guard.interface'

export interface PipeTransform {
  transform(value: any, context: IpcContext): any | Promise<any>
}
