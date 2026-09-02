import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ipcMain } from 'electron'
import {
  Module,
  Controller,
  IpcHandle,
  IpcOn,
  Injectable,
  AppEvent,
} from '@electrum/common'
import { DIContainer } from '../di/container'
import { IpcBridge } from '../bridge/ipc-bridge'
import { MiddlewarePipeline } from '../middleware/pipeline'
import { createApp } from '../application'
import type { Plugin } from '../plugin/plugin.interface'

vi.mock('electron', () => ({
  app: {
    on: vi.fn(),
    removeListener: vi.fn(),
    whenReady: vi.fn().mockResolvedValue(undefined),
  },
  ipcMain: {
    handle: vi.fn(),
    on: vi.fn(),
    removeHandler: vi.fn(),
    removeAllListeners: vi.fn(),
  },
  BrowserWindow: vi.fn().mockImplementation(() => ({
    webContents: { send: vi.fn(), openDevTools: vi.fn() },
    loadURL: vi.fn().mockResolvedValue(undefined),
    loadFile: vi.fn().mockResolvedValue(undefined),
    once: vi.fn(),
    on: vi.fn(),
    show: vi.fn(),
    isDestroyed: vi.fn(() => false),
  })),
}))

@Injectable()
class AppListener {
  @AppEvent('activate')
  onActivate() {}
}

@Controller('demo')
class DemoController {
  lastHandleArgs: unknown[] = []
  lastOnArgs: unknown[] = []

  @IpcHandle('ping')
  ping(...args: unknown[]) {
    this.lastHandleArgs = args
    return 'pong'
  }

  @IpcOn('msg')
  onMsg(...args: unknown[]) {
    this.lastOnArgs = args
  }

  @IpcHandle('secret', { devOnly: true })
  secret() {
    return 'dev'
  }
}

@Module({
  controllers: [DemoController],
  providers: [AppListener],
})
class TestModule {}

type ApplicationInternals = {
  shutdown: () => Promise<void>
  ipcBridge?: { unregisterAll: () => void }
  eventBridge?: { unregisterAll: () => void }
  lifecycle?: { runHook: (name: string) => Promise<void> }
  started: boolean
}

describe('IpcBridge', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('unregisterAll removes handle and on listeners for registered channels', () => {
    const container = new DIContainer()
    container.register(DemoController, { useClass: DemoController })
    const pipeline = new MiddlewarePipeline(container)
    const bridge = new IpcBridge(container, [{ controllers: [DemoController] }], pipeline)

    bridge.registerAll()
    bridge.unregisterAll()

    expect(ipcMain.handle).toHaveBeenCalledWith('demo:ping', expect.any(Function))
    expect(ipcMain.removeHandler).toHaveBeenCalledWith('demo:ping')
    expect(ipcMain.removeAllListeners).toHaveBeenCalledWith('demo:ping')
  })

  it('Handle strips event; On passes event as first argument', async () => {
    const container = new DIContainer()
    container.register(DemoController, { useClass: DemoController })
    const pipeline = new MiddlewarePipeline(container)
    const bridge = new IpcBridge(container, [{ controllers: [DemoController] }], pipeline)
    const instance = container.resolve<DemoController>(DemoController)

    bridge.registerAll()

    const handleCall = vi.mocked(ipcMain.handle).mock.calls.find((c) => c[0] === 'demo:ping')
    expect(handleCall).toBeTruthy()
    const event = { id: 7 }
    await handleCall![1](event as any, 'a', 'b')
    expect(instance.lastHandleArgs).toEqual(['a', 'b'])

    const onCall = vi.mocked(ipcMain.on).mock.calls.find((c) => c[0] === 'demo:msg')
    expect(onCall).toBeTruthy()
    onCall![1](event as any, 'x')
    // allow microtask for void executeGuardOnly
    await Promise.resolve()
    expect(instance.lastOnArgs).toEqual([event, 'x'])
  })

  it('skips duplicate channel registration', () => {
    @Controller('dup')
    class A {
      @IpcHandle('x')
      a() {
        return 1
      }
    }
    @Controller('dup')
    class B {
      @IpcHandle('x')
      b() {
        return 2
      }
    }

    const container = new DIContainer()
    container.register(A, { useClass: A })
    container.register(B, { useClass: B })
    const pipeline = new MiddlewarePipeline(container)
    const bridge = new IpcBridge(container, [{ controllers: [A, B] }], pipeline)

    bridge.registerAll()

    const handleCalls = vi.mocked(ipcMain.handle).mock.calls.filter((c) => c[0] === 'dup:x')
    expect(handleCalls).toHaveLength(1)
  })

  it('skips devOnly channels when NODE_ENV is not development', () => {
    const prev = process.env.NODE_ENV
    process.env.NODE_ENV = 'production'
    try {
      const container = new DIContainer()
      container.register(DemoController, { useClass: DemoController })
      const pipeline = new MiddlewarePipeline(container)
      const bridge = new IpcBridge(container, [{ controllers: [DemoController] }], pipeline)
      bridge.registerAll()

      const channels = vi.mocked(ipcMain.handle).mock.calls.map((c) => c[0])
      expect(channels).toContain('demo:ping')
      expect(channels).not.toContain('demo:secret')
    } finally {
      process.env.NODE_ENV = prev
    }
  })
})

describe('Application.shutdown', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('unregisters IPC and app event bridges exactly once', async () => {
    const app = createApp(TestModule)
    const internals = app as unknown as ApplicationInternals

    internals.ipcBridge = { unregisterAll: vi.fn() }
    internals.eventBridge = { unregisterAll: vi.fn() }
    internals.lifecycle = { runHook: vi.fn().mockResolvedValue(undefined) }

    await internals.shutdown()
    await internals.shutdown()

    expect(internals.ipcBridge?.unregisterAll).toHaveBeenCalledOnce()
    expect(internals.eventBridge?.unregisterAll).toHaveBeenCalledOnce()
    expect(internals.lifecycle?.runHook).toHaveBeenCalledOnce()
  })
})

describe('Application plugins', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('calls install immediately, ready on start, destroy on shutdown', async () => {
    const plugin: Plugin = {
      name: 'demo',
      install: vi.fn(),
      ready: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    }

    @Module({ controllers: [], providers: [] })
    class EmptyModule {}

    const app = createApp(EmptyModule)
    app.use(plugin)
    expect(plugin.install).toHaveBeenCalledWith(app)

    await app.start()
    expect(plugin.ready).toHaveBeenCalledWith(app)

    const internals = app as unknown as ApplicationInternals
    await internals.shutdown()
    expect(plugin.destroy).toHaveBeenCalledWith(app)
  })
})
