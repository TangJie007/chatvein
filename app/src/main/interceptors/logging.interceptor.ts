import { Injectable } from '@electrum/common'
import type { NestInterceptor, IpcContext } from '@electrum/common'

@Injectable()
export class LoggingInterceptor implements NestInterceptor {
  async intercept(context: IpcContext, next: () => Promise<any>) {
    const start = Date.now()
    const result = await next()
    console.log(`[IPC] ${context.channel} ${Date.now() - start}ms`)
    return result
  }
}
