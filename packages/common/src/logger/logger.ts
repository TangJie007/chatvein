export type LogLevel = 'debug' | 'log' | 'warn' | 'error' | 'verbose'

export class Logger {
  private static globalLevel: LogLevel = 'log'

  constructor(private context: string) {}

  static setLevel(level: LogLevel): void {
    Logger.globalLevel = level
  }

  debug(message: string, ...args: any[]): void {
    if (this.shouldLog('debug')) console.debug(`[${this.context}] ${message}`, ...args)
  }

  log(message: string, ...args: any[]): void {
    if (this.shouldLog('log')) console.log(`[${this.context}] ${message}`, ...args)
  }

  warn(message: string, ...args: any[]): void {
    if (this.shouldLog('warn')) console.warn(`[${this.context}] ${message}`, ...args)
  }

  error(message: string, ...args: any[]): void {
    if (this.shouldLog('error')) console.error(`[${this.context}] ${message}`, ...args)
  }

  private shouldLog(level: LogLevel): boolean {
    const levels: Record<LogLevel, number> = {
      debug: 0,
      verbose: 1,
      log: 2,
      warn: 3,
      error: 4,
    }
    return levels[level] >= levels[Logger.globalLevel]
  }
}
