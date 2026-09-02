import { describe, it, expect, vi, beforeEach } from 'vitest'
import { app } from 'electron'
import { Injectable, AppEvent } from '@electrum/common'
import { DIContainer } from '../di/container'
import { EventBridge } from '../bridge/event-bridge'

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    removeListener: vi.fn(),
  },
}))

@Injectable()
class AppListener {
  @AppEvent('activate')
  onActivate() {}
}

describe('EventBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
})
