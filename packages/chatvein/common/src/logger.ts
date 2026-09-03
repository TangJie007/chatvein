/**
 * 最小日志接口。
 *
 * harness 能力包不得依赖 @electrum/*（红线方向），故在此自带一个轻量 Logger，
 * 与 observability 的 TraceSink（结构化 trace 事件）分工：
 *  - Logger：面向人/控制台的运行日志（debug/info/warn/error）；
 *  - TraceSink：面向复盘的结构化事件，落 trace.jsonl。
 * CLI 用 console 实现；测试可传 noop logger；core 可桥接到 Cordis logger。
 */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 }

export interface LogEntry {
  level: LogLevel
  msg: string
  meta?: Record<string, unknown>
  ts: number
}

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void
  info(msg: string, meta?: Record<string, unknown>): void
  warn(msg: string, meta?: Record<string, unknown>): void
  error(msg: string, meta?: Record<string, unknown>): void
  /** 派生带固定绑定字段（如 runId/node）的子 logger */
  child(bindings: Record<string, unknown>): Logger
}

export interface ConsoleLoggerOptions {
  /** 最低输出级别；默认 'info' */
  level?: LogLevel
  /** 固定绑定字段，附加到每条日志 */
  bindings?: Record<string, unknown>
  /** 输出 sink；默认 console，测试可注入收集器 */
  sink?: (entry: LogEntry) => void
}

/** 基于 console 的 Logger 实现 */
export function createConsoleLogger(options: ConsoleLoggerOptions = {}): Logger {
  const threshold = LEVEL_WEIGHT[options.level ?? 'info']
  const baseBindings = options.bindings ?? {}
  const sink =
    options.sink ??
    ((entry: LogEntry) => {
      const meta = entry.meta && Object.keys(entry.meta).length ? ` ${JSON.stringify(entry.meta)}` : ''
      const line = `[${entry.level}] ${entry.msg}${meta}`
      if (entry.level === 'error') console.error(line)
      else if (entry.level === 'warn') console.warn(line)
      else console.log(line)
    })

  const log = (level: LogLevel, msg: string, meta?: Record<string, unknown>) => {
    if (LEVEL_WEIGHT[level] < threshold) return
    sink({ level, msg, meta: { ...baseBindings, ...(meta ?? {}) }, ts: Date.now() })
  }

  return {
    debug: (msg, meta) => log('debug', msg, meta),
    info: (msg, meta) => log('info', msg, meta),
    warn: (msg, meta) => log('warn', msg, meta),
    error: (msg, meta) => log('error', msg, meta),
    child: (bindings) =>
      createConsoleLogger({
        level: options.level ?? 'info',
        bindings: { ...baseBindings, ...bindings },
        sink: options.sink,
      }),
  }
}

/** 静默 logger（测试 / 不关心日志的场景） */
export function createNullLogger(): Logger {
  const noop = () => {}
  const self: Logger = {
    debug: noop,
    info: noop,
    warn: noop,
    error: noop,
    child: () => self,
  }
  return self
}
