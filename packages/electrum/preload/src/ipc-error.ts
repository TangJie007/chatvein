/** Matches @electrum/common IpcErrorResponse shape from the main process. */
export interface IpcErrorPayload {
  __error: true
  code: string
  message: string
  stack?: string
  details?: unknown
}

export class IpcError extends Error {
  constructor(
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message)
    this.name = 'IpcError'
  }
}

export function isIpcErrorPayload(value: unknown): value is IpcErrorPayload {
  return (
    !!value &&
    typeof value === 'object' &&
    (value as IpcErrorPayload).__error === true &&
    typeof (value as IpcErrorPayload).code === 'string' &&
    typeof (value as IpcErrorPayload).message === 'string'
  )
}
