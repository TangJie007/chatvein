import { Injectable, ElectronException } from '@electrum/common'
import type { ExceptionFilter, IpcContext, IpcErrorResponse } from '@electrum/common'

@Injectable()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, _context: IpcContext): IpcErrorResponse {
    if (exception instanceof ElectronException) {
      return exception.toJSON()
    }
    if (exception instanceof Error) {
      return {
        __error: true,
        code: 'INTERNAL',
        message: exception.message,
        ...(process.env.NODE_ENV?.includes('dev') ? { stack: exception.stack } : {}),
      }
    }
    return { __error: true, code: 'UNKNOWN', message: 'An unknown error occurred' }
  }
}
