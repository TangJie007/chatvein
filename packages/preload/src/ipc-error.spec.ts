import { describe, it, expect } from 'vitest'
import { IpcError, isIpcErrorPayload } from './ipc-error'

describe('isIpcErrorPayload', () => {
  it('accepts electrum error shape', () => {
    expect(
      isIpcErrorPayload({
        __error: true,
        code: 'NOT_FOUND',
        message: 'missing',
      }),
    ).toBe(true)
  })

  it('rejects normal payloads', () => {
    expect(isIpcErrorPayload({ ok: true })).toBe(false)
    expect(isIpcErrorPayload(null)).toBe(false)
  })
})

describe('IpcError', () => {
  it('keeps code and details', () => {
    const err = new IpcError('FORBIDDEN', 'nope', { id: 1 })
    expect(err).toBeInstanceOf(Error)
    expect(err.name).toBe('IpcError')
    expect(err.code).toBe('FORBIDDEN')
    expect(err.details).toEqual({ id: 1 })
  })
})
