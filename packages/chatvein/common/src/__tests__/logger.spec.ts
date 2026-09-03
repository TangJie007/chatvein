import { describe, expect, it } from 'vitest'
import { createConsoleLogger, createNullLogger, type LogEntry } from '../logger'

describe('createConsoleLogger', () => {
  it('按级别过滤：info 级别不输出 debug', () => {
    const entries: LogEntry[] = []
    const log = createConsoleLogger({ level: 'info', sink: (e) => entries.push(e) })
    log.debug('d')
    log.info('i')
    log.warn('w')
    log.error('e')
    expect(entries.map((e) => e.level)).toEqual(['info', 'warn', 'error'])
  })

  it('debug 级别输出全部', () => {
    const entries: LogEntry[] = []
    const log = createConsoleLogger({ level: 'debug', sink: (e) => entries.push(e) })
    log.debug('d')
    expect(entries).toHaveLength(1)
  })

  it('child 继承并合并绑定字段', () => {
    const entries: LogEntry[] = []
    const log = createConsoleLogger({ bindings: { runId: 'r1' }, sink: (e) => entries.push(e) })
    const child = log.child({ node: 'plan' })
    child.info('hi', { extra: 1 })
    expect(entries[0]?.meta).toEqual({ runId: 'r1', node: 'plan', extra: 1 })
  })

  it('条目带时间戳', () => {
    const entries: LogEntry[] = []
    createConsoleLogger({ sink: (e) => entries.push(e) }).info('x')
    expect(typeof entries[0]?.ts).toBe('number')
    expect(entries[0]?.ts).toBeGreaterThan(0)
  })
})

describe('createNullLogger', () => {
  it('所有方法为 noop 且 child 返回自身', () => {
    const log = createNullLogger()
    expect(() => {
      log.debug('a')
      log.info('b')
      log.warn('c')
      log.error('d')
    }).not.toThrow()
    expect(log.child({ x: 1 })).toBe(log)
  })
})
