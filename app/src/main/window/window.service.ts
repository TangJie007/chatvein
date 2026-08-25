import { join } from 'node:path'
import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron'
import { Injectable, Logger } from '@electrum/common'

@Injectable()
export class WindowService {
  private logger = new Logger('WindowService')
  private childSeq = 0

  private sharedOptions(): BrowserWindowConstructorOptions {
    return {
      width: 1100,
      height: 720,
      minWidth: 880,
      minHeight: 560,
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      backgroundColor: '#f5f7fa',
      webPreferences: {
        preload: join(__dirname, '../preload/index.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
      },
    }
  }

  getFocused(): BrowserWindow | null {
    return BrowserWindow.getFocusedWindow()
  }

  minimize(win: BrowserWindow | null): void {
    win?.minimize()
  }

  toggleMaximize(win: BrowserWindow | null): boolean {
    if (!win) return false
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
    return win.isMaximized()
  }

  isMaximized(win: BrowserWindow | null): boolean {
    return win?.isMaximized() ?? false
  }

  close(win: BrowserWindow | null): void {
    win?.close()
  }

  /** 打开一个独立的子窗口（同一套渲染页，通过 query 区分） */
  openChild(query: Record<string, string> = {}): { id: number; title: string } {
    const id = ++this.childSeq
    const title = query.title || `子窗口 #${id}`
    const win = new BrowserWindow({
      ...this.sharedOptions(),
      width: 920,
      height: 640,
      title,
      parent: undefined,
    })

    const params = new URLSearchParams({ view: 'child', title, ...query })
    this.load(win, params)
    win.once('ready-to-show', () => {
      if (!win.isDestroyed()) win.show()
    })
    win.on('closed', () => {
      this.logger.log(`Child window #${id} closed`)
    })

    this.logger.log(`Child window #${id} opened`)
    return { id: win.id, title }
  }

  listWindows(): Array<{ id: number; title: string; focused: boolean }> {
    const focused = BrowserWindow.getFocusedWindow()
    return BrowserWindow.getAllWindows()
      .filter((w) => !w.isDestroyed())
      .map((w) => ({
        id: w.id,
        title: w.getTitle() || `Window ${w.id}`,
        focused: focused?.id === w.id,
      }))
  }

  focus(id: number): boolean {
    const win = BrowserWindow.fromId(id)
    if (!win || win.isDestroyed()) return false
    if (win.isMinimized()) win.restore()
    win.focus()
    return true
  }

  private load(win: BrowserWindow, params: URLSearchParams): void {
    const isDev = !!process.env.ELECTRON_RENDERER_URL || process.env.NODE_ENV?.includes('dev')
    if (isDev && process.env.ELECTRON_RENDERER_URL) {
      const base = process.env.ELECTRON_RENDERER_URL.replace(/\/$/, '')
      void win.loadURL(`${base}/?${params.toString()}`)
    } else {
      void win.loadFile(join(__dirname, '../renderer/index.html'), {
        search: params.toString(),
      })
    }
  }
}
