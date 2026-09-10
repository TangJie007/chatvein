import { describe, it, expect, vi, beforeEach } from 'vitest'
import { BrowserWindow } from 'electron'
import { WindowDeclaration } from '@electrum/common'
import { DIContainer } from '../di/container'
import { WindowManager } from '../window/manager'

const windows: Array<{
  webContents: { send: ReturnType<typeof vi.fn> }
  loadURL: ReturnType<typeof vi.fn>
  loadFile: ReturnType<typeof vi.fn>
  once: ReturnType<typeof vi.fn>
  on: ReturnType<typeof vi.fn>
  show: ReturnType<typeof vi.fn>
  isDestroyed: ReturnType<typeof vi.fn>
}> = []

vi.mock('electron', () => ({
  BrowserWindow: vi.fn().mockImplementation((options: unknown) => {
    const win = {
      options,
      webContents: { send: vi.fn() },
      loadURL: vi.fn().mockResolvedValue(undefined),
      loadFile: vi.fn().mockResolvedValue(undefined),
      once: vi.fn(),
      on: vi.fn(),
      show: vi.fn(),
      isDestroyed: vi.fn(() => false),
    }
    windows.push(win)
    return win
  }),
}))

@WindowDeclaration({
  name: 'main',
  options: { width: 800, height: 600 },
  prodFile: 'index.html',
  autoCreate: true,
})
class MainWindow {}

@WindowDeclaration({
  name: 'lazy',
  autoCreate: false,
})
class LazyWindow {}

describe('WindowManager', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    windows.length = 0
    delete process.env.ELECTRON_RENDERER_URL
    delete process.env.NODE_ENV
  })

  it('auto-creates declared windows and wires DI window provider', async () => {
    const container = new DIContainer()
    const manager = new WindowManager(container)

    await manager.initialize([
      {
        moduleClass: class {},
        metadata: {},
        controllers: [],
        providers: [],
        declarations: [MainWindow, LazyWindow],
      },
    ])

    expect(BrowserWindow).toHaveBeenCalledOnce()
    expect(manager.getWindow('main')).toBe(windows[0])
    expect(manager.getWindow('lazy')).toBeUndefined()

    const viaDi = container.resolve(Symbol.for('electrum:window:main'))
    expect(viaDi).toBe(windows[0])
  })

  it('sendTo and broadcast push via webContents.send', async () => {
    const container = new DIContainer()
    const manager = new WindowManager(container)
    await manager.initialize([
      {
        moduleClass: class {},
        metadata: {},
        controllers: [],
        providers: [],
        declarations: [MainWindow],
      },
    ])
    manager.createWindow({ name: 'child', options: { width: 400, height: 300 } })
    expect(windows).toHaveLength(2)

    manager.sendTo('main', 'ping', 1)
    expect(windows[0].webContents.send).toHaveBeenCalledWith('ping', 1)
    expect(windows[1].webContents.send).not.toHaveBeenCalled()

    manager.broadcast('news', 'x')
    expect(windows[0].webContents.send).toHaveBeenCalledWith('news', 'x')
    expect(windows[1].webContents.send).toHaveBeenCalledWith('news', 'x')
  })

  it('skips send when window is destroyed', async () => {
    const container = new DIContainer()
    const manager = new WindowManager(container)
    await manager.initialize([
      {
        moduleClass: class {},
        metadata: {},
        controllers: [],
        providers: [],
        declarations: [MainWindow],
      },
    ])

    windows[0].isDestroyed.mockReturnValue(true)
    manager.sendTo('main', 'ping')
    expect(windows[0].webContents.send).not.toHaveBeenCalled()
  })
})
