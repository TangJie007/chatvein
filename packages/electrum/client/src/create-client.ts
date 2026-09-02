import type {
  CreateClientOptions,
  ElectrumBridge,
  ElectrumClient,
  IpcApiMap,
} from './types'

function getBridge(key: string): ElectrumBridge {
  const host = globalThis as typeof globalThis & Record<string, ElectrumBridge | undefined>
  const bridge = host[key]
  if (!bridge?.invoke) {
    throw new Error(
      `window.${key} is missing. Call exposeApi() from @electrum/preload in the preload script.`,
    )
  }
  return bridge
}

/**
 * 渲染进程 IPC 客户端。
 *
 * ```ts
 * const api = createClient<IpcApi>()
 * await api.user.list()           // → invoke('user:list')
 * await api.file.read('/a.txt')   // → invoke('file:read', '/a.txt')
 * await api.invoke('app:ping', 'hi')
 * api.on('file:saved', (p) => {})
 * ```
 */
export function createClient<T extends IpcApiMap = IpcApiMap>(
  options: CreateClientOptions = {},
): ElectrumClient<T> {
  const key = options.key ?? 'api'
  const bridge = options.bridge ?? getBridge(key)

  const invoke = ((channel: string, ...args: unknown[]) =>
    bridge.invoke(channel, ...args)) as unknown as ElectrumClient<T>['invoke']

  const on = ((channel: string, listener: (...args: any[]) => void) =>
    bridge.on(channel, listener)) as ElectrumClient<T>['on']

  const send = ((channel: string, ...args: any[]) =>
    bridge.send(channel, ...args)) as ElectrumClient<T>['send']

  const prefixCache = new Map<string, object>()

  const client = new Proxy(
    { invoke, on, send } as ElectrumClient<T>,
    {
      get(target, prop, receiver) {
        if (prop === 'invoke' || prop === 'on' || prop === 'send') {
          return Reflect.get(target, prop, receiver)
        }
        if (typeof prop === 'symbol') {
          return Reflect.get(target, prop, receiver)
        }

        const prefix = prop
        let ns = prefixCache.get(prefix)
        if (!ns) {
          ns = new Proxy(
            {},
            {
              get(_t, method) {
                if (typeof method === 'symbol') return undefined
                return (...args: unknown[]) => bridge.invoke(`${prefix}:${method}`, ...args)
              },
            },
          )
          prefixCache.set(prefix, ns)
        }
        return ns
      },
    },
  )

  return client
}
