import { contextBridge, ipcRenderer } from 'electron'
import { IpcError, isIpcErrorPayload } from './ipc-error'

export interface ElectrumApi {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void
  send: (channel: string, ...args: unknown[]) => void
}

export interface ExposeApiOptions {
  /** window 上挂载的键名，默认 `api` → `window.api` */
  key?: string
}

/**
 * 在 preload 中暴露与 Electrum 主进程配套的 IPC 桥：
 * - invoke：处理 Handle 返回的 `{ __error }` 并抛出 IpcError
 * - on / send：事件通道
 *
 * 幂等：开发期 preload 热重载再次执行时，`exposeInMainWorld` 会因
 * “Cannot bind an API on top of an existing property” 失败——此时吞掉该错，
 * 保留已有 `window.api`。
 */
export function exposeApi(options: ExposeApiOptions = {}): ElectrumApi {
  const key = options.key ?? 'api'
  const api: ElectrumApi = {
    invoke: async (channel, ...args) => {
      const result = await ipcRenderer.invoke(channel, ...args)
      if (isIpcErrorPayload(result)) {
        throw new IpcError(result.code, result.message, result.details)
      }
      return result
    },
    on: (channel, listener) => {
      const handler = (_event: Electron.IpcRendererEvent, ...args: unknown[]) =>
        listener(...args)
      ipcRenderer.on(channel, handler)
      return () => {
        ipcRenderer.removeListener(channel, handler)
      }
    },
    send: (channel, ...args) => {
      ipcRenderer.send(channel, ...args)
    },
  }

  try {
    contextBridge.exposeInMainWorld(key, api)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // Electron：同一 key 不可重复 expose（HMR / 重复执行 preload）
    if (!/existing property|Cannot bind an API|Cannot redefine/i.test(msg)) {
      throw err
    }
  }
  return api
}
