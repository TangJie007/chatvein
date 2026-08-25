import type { IpcContext } from '../guards/guard.interface'

export interface NestInterceptor {
  intercept(context: IpcContext, next: () => Promise<any>): Promise<any>
}
