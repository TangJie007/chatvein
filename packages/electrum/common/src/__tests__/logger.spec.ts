import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { Logger } from '../logger/logger'

describe('Logger', () => {
  beforeEach(() => {
    Logger.setLevel('verbose')
  })

  afterEach(() => {
    Logger.setLevel('log')
    vi.restoreAllMocks()
  })

  it('logs at verbose level when global level is verbose', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = new Logger('Test')

    logger.verbose('detail message')

    expect(spy).toHaveBeenCalledWith('[Test] detail message')
  })

  it('suppresses verbose when global level is log', () => {
    Logger.setLevel('log')
    const spy = vi.spyOn(console, 'log').mockImplementation(() => {})
    const logger = new Logger('Test')

    logger.verbose('detail message')

    expect(spy).not.toHaveBeenCalled()
  })
})
