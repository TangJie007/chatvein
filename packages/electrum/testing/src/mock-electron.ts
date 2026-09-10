export type MockIpcHandler = (event: unknown, ...args: unknown[]) => unknown | Promise<unknown>
export type MockIpcListener = (event: unknown, ...args: unknown[]) => void
export type MockAppListener = (...args: unknown[]) => void

export interface MockBrowserWindowOptions {
  webPreferences?: Record<string, unknown>
  width?: number
  height?: number
  show?: boolean
  [key: string]: unknown
}

export class MockBrowserWindow {
  static instances: MockBrowserWindow[] = []

  webContents = {
    send: (channel: string, ...args: unknown[]) => {
      this.sent.push({ channel, args })
    },
    id: MockBrowserWindow.instances.length + 1,
  }

  sent: Array<{ channel: string; args: unknown[] }> = []
  destroyed = false

  constructor(public options: MockBrowserWindowOptions = {}) {
    MockBrowserWindow.instances.push(this)
  }

  loadURL(_url: string): Promise<void> {
    return Promise.resolve()
  }

  loadFile(_filePath: string): Promise<void> {
    return Promise.resolve()
  }

  show(): void {}
  hide(): void {}
  focus(): void {}
  close(): void {
    this.destroyed = true
  }
  destroy(): void {
    this.destroyed = true
  }
  isDestroyed(): boolean {
    return this.destroyed
  }
  on(_event: string, _listener: (...args: unknown[]) => void): this {
    return this
  }
  once(_event: string, _listener: (...args: unknown[]) => void): this {
    return this
  }
}

export interface MockElectron {
  app: {
    whenReady: () => Promise<void>
    on: (event: string, listener: MockAppListener) => void
    once: (event: string, listener: MockAppListener) => void
    removeListener: (event: string, listener: MockAppListener) => void
    quit: () => void
    getAppPath: () => string
    isReady: () => boolean
  }
  ipcMain: {
    handle: (channel: string, listener: MockIpcHandler) => void
    on: (channel: string, listener: MockIpcListener) => void
    removeHandler: (channel: string) => void
    removeAllListeners: (channel?: string) => void
    /** Test helper: invoke a registered handle channel */
    invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
    /** Test helper: emit to registered on listeners */
    emit: (channel: string, ...args: unknown[]) => void
    /** Test helper: list handle channels */
    handleChannels: () => string[]
    /** Test helper: list on channels */
    onChannels: () => string[]
  }
  BrowserWindow: typeof MockBrowserWindow
  /** Clear all registered handlers / listeners / windows */
  reset: () => void
}

/**
 * Build an in-memory Electron mock for unit / integration tests.
 *
 * Typical Vitest usage:
 *
 * ```ts
 * import { mockElectron } from '@electrum/testing'
 *
 * const electron = mockElectron()
 * vi.mock('electron', () => electron)
 * ```
 */
export function mockElectron(): MockElectron {
  const handleHandlers = new Map<string, MockIpcHandler>()
  const onListeners = new Map<string, Set<MockIpcListener>>()
  const appListeners = new Map<string, Set<MockAppListener>>()
  let ready = false

  const ipcMain = {
    handle(channel: string, listener: MockIpcHandler): void {
      handleHandlers.set(channel, listener)
    },
    on(channel: string, listener: MockIpcListener): void {
      let set = onListeners.get(channel)
      if (!set) {
        set = new Set()
        onListeners.set(channel, set)
      }
      set.add(listener)
    },
    removeHandler(channel: string): void {
      handleHandlers.delete(channel)
    },
    removeAllListeners(channel?: string): void {
      if (channel) onListeners.delete(channel)
      else onListeners.clear()
    },
    async invoke(channel: string, ...args: unknown[]): Promise<unknown> {
      const handler = handleHandlers.get(channel)
      if (!handler) {
        throw new Error(`No ipcMain.handle registered for channel "${channel}"`)
      }
      return handler({ sender: { id: 1 } }, ...args)
    },
    emit(channel: string, ...args: unknown[]): void {
      const listeners = onListeners.get(channel)
      if (!listeners) return
      for (const listener of listeners) {
        listener({ sender: { id: 1 } }, ...args)
      }
    },
    handleChannels(): string[] {
      return [...handleHandlers.keys()]
    },
    onChannels(): string[] {
      return [...onListeners.keys()]
    },
  }

  const app = {
    whenReady(): Promise<void> {
      ready = true
      return Promise.resolve()
    },
    on(event: string, listener: MockAppListener): void {
      let set = appListeners.get(event)
      if (!set) {
        set = new Set()
        appListeners.set(event, set)
      }
      set.add(listener)
    },
    once(event: string, listener: MockAppListener): void {
      const wrap: MockAppListener = (...args) => {
        app.removeListener(event, wrap)
        listener(...args)
      }
      app.on(event, wrap)
    },
    removeListener(event: string, listener: MockAppListener): void {
      appListeners.get(event)?.delete(listener)
    },
    quit(): void {
      const listeners = appListeners.get('before-quit')
      if (listeners) {
        for (const listener of [...listeners]) listener()
      }
    },
    getAppPath(): string {
      return process.cwd()
    },
    isReady(): boolean {
      return ready
    },
  }

  const reset = (): void => {
    handleHandlers.clear()
    onListeners.clear()
    appListeners.clear()
    MockBrowserWindow.instances = []
    ready = false
  }

  return {
    app,
    ipcMain,
    BrowserWindow: MockBrowserWindow,
    reset,
  }
}
