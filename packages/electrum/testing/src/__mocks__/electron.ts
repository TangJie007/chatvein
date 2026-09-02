/** Vitest alias target — avoids loading a real Electron binary. */
export const app = {
  whenReady: async () => undefined,
  on: () => undefined,
  once: () => undefined,
  removeListener: () => undefined,
  quit: () => undefined,
  getAppPath: () => process.cwd(),
  isReady: () => true,
}

export const ipcMain = {
  handle: () => undefined,
  on: () => undefined,
  removeHandler: () => undefined,
  removeAllListeners: () => undefined,
}

export class BrowserWindow {}

export default { app, ipcMain, BrowserWindow }
