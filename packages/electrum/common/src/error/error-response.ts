export interface IpcErrorResponse {
  __error: true
  code: string
  message: string
  stack?: string
  details?: unknown
}
