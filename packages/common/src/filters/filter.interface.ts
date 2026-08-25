import type { IpcContext } from '../guards/guard.interface'
import type { IpcErrorResponse } from '../error/error-response'

export interface ExceptionFilter {
  catch(exception: unknown, context: IpcContext): IpcErrorResponse
}
