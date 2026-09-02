import type { IpcErrorResponse } from './error-response'

export class ElectronException extends Error {
  constructor(
    message: string,
    public code: string = 'INTERNAL',
    public statusCode: number = 500,
    public details?: unknown,
  ) {
    super(message)
    this.name = this.constructor.name
  }

  toJSON(): IpcErrorResponse {
    return {
      __error: true,
      code: this.code,
      message: this.message,
      details: this.details,
      ...(process.env.NODE_ENV?.includes('dev') ? { stack: this.stack } : {}),
    }
  }
}

export class NotFoundException extends ElectronException {
  constructor(resource: string) {
    super(`${resource} not found`, 'NOT_FOUND', 404)
  }
}

export class ForbiddenException extends ElectronException {
  constructor(message = 'Access forbidden') {
    super(message, 'FORBIDDEN', 403)
  }
}

export class ValidationException extends ElectronException {
  constructor(
    message: string,
    public errors: unknown[],
  ) {
    super(message, 'VALIDATION_ERROR', 422, errors)
  }
}
