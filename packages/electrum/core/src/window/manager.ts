import { BrowserWindow } from 'electron'
import { META, readMetadata, Logger, type WindowOptions } from '@electrum/common'
import type { DIContainer } from '../di/container'
import type { ScannedModule } from '../module/scanner'

export class WindowManager {
  private logger = new Logger('WindowManager')
  private windows = new Map<string, BrowserWindow>()

  constructor(private container: DIContainer) {}

  async initialize(scannedModules: ScannedModule[]): Promise<void> {
    this.container.setWindowProvider((name) => this.getWindow(name))

    for (const mod of scannedModules) {
      for (const declClass of mod.declarations || []) {
        const config = readMetadata<WindowOptions>(declClass, META.WINDOW_DECLARATION)
        if (!config) continue
        if (config.autoCreate !== false) {
          this.createWindow(config)
        }
      }
    }
  }

  createWindow(config: WindowOptions): BrowserWindow {
    const win = new BrowserWindow(config.options || {})

    const isDev = !!process.env.ELECTRON_RENDERER_URL || process.env.NODE_ENV?.includes('dev')

    if (isDev && (process.env.ELECTRON_RENDERER_URL || config.devUrl)) {
      const url = process.env.ELECTRON_RENDERER_URL || config.devUrl!
      void win.loadURL(url)
      if (process.env.ELECTRON_OPEN_DEVTOOLS === '1') {
        win.webContents.openDevTools({ mode: 'detach' })
      }
    } else if (config.prodFile) {
      void win.loadFile(config.prodFile)
    }

    this.windows.set(config.name, win)
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
    })
    win.on('closed', () => {
      this.windows.delete(config.name)
    })

    this.logger.log(`Window "${config.name}" created`)
    return win
  }

  getWindow(name = 'main'): BrowserWindow | undefined {
    return this.windows.get(name)
  }

  getAllWindows(): BrowserWindow[] {
    return [...this.windows.values()]
  }

  sendTo(name: string, channel: string, ...args: any[]): void {
    const win = this.windows.get(name)
    if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
  }

  broadcast(channel: string, ...args: any[]): void {
    for (const win of this.windows.values()) {
      if (!win.isDestroyed()) win.webContents.send(channel, ...args)
    }
  }
}
