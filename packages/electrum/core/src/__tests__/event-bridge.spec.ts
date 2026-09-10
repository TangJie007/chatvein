import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from 'electron'
import { Injectable, AppEvent } from '@electrum/common'
import { DIContainer } from '../di/container'
import { EventBridge } from '../bridge/event-bridge'

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    removeListener: vi.fn(),
    isReady: vi.fn(() => false),
  },
}))

@Injectable()
class AppListener {
  @AppEvent('activate')
  onActivate() {}
}

@Injectable()
class ReadyListener {
  hits = 0

  @AppEvent('ready')
  onReady() {
    this.hits += 1
  }
}

describe('EventBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(app.isReady).mockReturnValue(false)
  })

  it('unregisterAll removes all registered app listeners', () => {
    const container = new DIContainer()
    container.register(AppListener, { useClass: AppListener })

    const bridge = new EventBridge(container, [{ controllers: [], providers: [AppListener] }])
    bridge.registerAll()
    bridge.unregisterAll()

    expect(app.on).toHaveBeenCalledOnce()
    expect(app.removeListener).toHaveBeenCalledOnce()

    const listener = vi.mocked(app.on).mock.calls[0][1]
    expect(app.removeListener).toHaveBeenCalledWith('activate', listener)
  })

  it('replays ready immediately when app is already ready', async () => {
    vi.mocked(app.isReady).mockReturnValue(true)

    const container = new DIContainer()
    container.register(ReadyListener, { useClass: ReadyListener })
    const listener = container.resolve<ReadyListener>(ReadyListener)

    const bridge = new EventBridge(container, [{ controllers: [], providers: [ReadyListener] }])
    bridge.registerAll()

    expect(app.on).toHaveBeenCalledWith('ready', expect.any(Function))
    await Promise.resolve() // flush queueMicrotask
    expect(listener.hits).toBe(1)
  })

  it('does not replay ready when app is not ready yet', async () => {
    const container = new DIContainer()
    container.register(ReadyListener, { useClass: ReadyListener })
    const listener = container.resolve<ReadyListener>(ReadyListener)

    const bridge = new EventBridge(container, [{ controllers: [], providers: [ReadyListener] }])
    bridge.registerAll()

    await Promise.resolve()
    expect(listener.hits).toBe(0)
  })
})
