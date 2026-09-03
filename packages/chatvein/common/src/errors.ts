/** harness 错误基类；code 供 trace / UI 分类 */
export class ChatveinError extends Error {
  readonly code: string

  constructor(message: string, code = 'CHATVEIN_ERROR') {
    super(message)
    this.name = 'ChatveinError'
    this.code = code
  }
}

export class ValidationError extends ChatveinError {
  constructor(message: string) {
    super(message, 'VALIDATION')
    this.name = 'ValidationError'
  }
}

export class ModelError extends ChatveinError {
  constructor(message: string, code = 'MODEL') {
    super(message, code)
    this.name = 'ModelError'
  }
}

export class BudgetExceededError extends ChatveinError {
  constructor(message: string) {
    super(message, 'BUDGET_EXCEEDED')
    this.name = 'BudgetExceededError'
  }
}

export class NotFoundError extends ChatveinError {
  constructor(message: string) {
    super(message, 'NOT_FOUND')
    this.name = 'NotFoundError'
  }
}
