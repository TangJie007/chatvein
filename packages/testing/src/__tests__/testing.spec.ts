import { describe, it, expect, beforeEach } from 'vitest'
import {
  Injectable,
  Inject,
  Controller,
  IpcHandle,
  META,
  readMetadata,
} from '@electrum/common'
import { createTestContainer } from '../test-container'
import { mockElectron, MockBrowserWindow } from '../mock-electron'

@Injectable()
class ConfigService {
  env = 'test'
}

@Injectable()
class FileService {
  @Inject(ConfigService) config!: ConfigService

  read() {
    return `env=${this.config.env}`
  }
}

@Controller('file')
class FileController {
  @IpcHandle('read')
  read(path: string) {
    return path
  }
}

describe('createTestContainer', () => {
  it('returns mocked value after mock(token, value)', () => {
    const container = createTestContainer().mock('APP_CONFIG', { version: '1.0.0' })
    expect(container.resolve('APP_CONFIG')).toEqual({ version: '1.0.0' })
  })

  it('resolves a Service with @Inject dependencies', () => {
    const container = createTestContainer()
      .register(ConfigService, { useClass: ConfigService })
      .register(FileService, { useClass: FileService })

    const service = container.resolve<FileService>(FileService)
    expect(service.read()).toBe('env=test')
  })

  it('can replace an injected dependency via mock', () => {
    const container = createTestContainer()
      .mock(ConfigService, { env: 'prod' })
      .register(FileService, { useClass: FileService })

    const service = container.resolve<FileService>(FileService)
    expect(service.read()).toBe('env=prod')
  })
})

describe('mockElectron', () => {
  let electron: ReturnType<typeof mockElectron>

  beforeEach(() => {
    electron = mockElectron()
  })

  it('registers and invokes ipcMain.handle channels', async () => {
    electron.ipcMain.handle('demo:ping', (_event, name: unknown) => `pong:${name}`)

    await expect(electron.ipcMain.invoke('demo:ping', 'a')).resolves.toBe('pong:a')
    expect(electron.ipcMain.handleChannels()).toEqual(['demo:ping'])
  })

  it('emits to ipcMain.on listeners and cleans up with removeAllListeners', () => {
    const received: unknown[] = []
    electron.ipcMain.on('demo:watch', (_event, path) => {
      received.push(path)
    })

    electron.ipcMain.emit('demo:watch', '/tmp/a')
    expect(received).toEqual(['/tmp/a'])

    electron.ipcMain.removeAllListeners('demo:watch')
    electron.ipcMain.emit('demo:watch', '/tmp/b')
    expect(received).toEqual(['/tmp/a'])
  })

  it('tracks BrowserWindow instances and supports webContents.send', () => {
    const win = new electron.BrowserWindow({ width: 800, height: 600 })
    win.webContents.send('push', 1)

    expect(MockBrowserWindow.instances).toHaveLength(1)
    expect(win.sent).toEqual([{ channel: 'push', args: [1] }])
  })

  it('reset clears handlers, listeners, and windows', async () => {
    electron.ipcMain.handle('x', () => 1)
    electron.ipcMain.on('y', () => {})
    new electron.BrowserWindow()

    electron.reset()

    expect(electron.ipcMain.handleChannels()).toEqual([])
    expect(electron.ipcMain.onChannels()).toEqual([])
    expect(MockBrowserWindow.instances).toEqual([])
    await expect(electron.ipcMain.invoke('x')).rejects.toThrow(/No ipcMain.handle/)
  })

  it('app.whenReady resolves and marks isReady', async () => {
    expect(electron.app.isReady()).toBe(false)
    await electron.app.whenReady()
    expect(electron.app.isReady()).toBe(true)
  })
})

describe('metadata helpers', () => {
  it('can assert CONTROLLER and IPC_HANDLE metadata via readMetadata', () => {
    const controller = readMetadata<{ prefix: string }>(FileController, META.CONTROLLER)
    expect(controller?.prefix).toBe('file')

    const handles = readMetadata<Array<{ channel: string }>>(FileController, META.IPC_HANDLE)
    expect(handles?.map((h) => h.channel)).toEqual(['read'])
  })
})
