import { describe, it, expect, vi } from 'vitest'
import { createClient } from './create-client'

type DemoApi = {
  'user:list': () => Promise<{ id: number }[]>
  'user:get': (id: number) => Promise<{ id: number }>
  'file:read': (path: string) => Promise<string>
}

describe('createClient', () => {
  it('invoke delegates to bridge', async () => {
    const bridge = {
      invoke: vi.fn(async () => [{ id: 1 }]),
      on: vi.fn(() => () => {}),
      send: vi.fn(),
    }
    const api = createClient<DemoApi>({ bridge })
    const users = await api.invoke('user:list')
    expect(bridge.invoke).toHaveBeenCalledWith('user:list')
    expect(users).toEqual([{ id: 1 }])
  })

  it('nested proxy maps to channel', async () => {
    const bridge = {
      invoke: vi.fn(async (_ch: string, path?: unknown) => `content:${path}`),
      on: vi.fn(() => () => {}),
      send: vi.fn(),
    }
    const api = createClient<DemoApi>({ bridge })
    const text = await api.file.read('/a.txt')
    expect(bridge.invoke).toHaveBeenCalledWith('file:read', '/a.txt')
    expect(text).toBe('content:/a.txt')

    await api.user.get(2)
    expect(bridge.invoke).toHaveBeenCalledWith('user:get', 2)
  })

  it('on / send pass through', () => {
    const off = vi.fn()
    const bridge = {
      invoke: vi.fn(),
      on: vi.fn(() => off),
      send: vi.fn(),
    }
    const api = createClient({ bridge })
    const listener = () => {}
    const dispose = api.on('file:saved', listener)
    expect(bridge.on).toHaveBeenCalledWith('file:saved', listener)
    dispose()
    expect(off).toHaveBeenCalled()

    api.send('file:watch', '/x')
    expect(bridge.send).toHaveBeenCalledWith('file:watch', '/x')
  })
})
