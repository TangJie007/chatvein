/** Channel map: `'user:list': () => Promise<User[]>` */
export type IpcApiMap = Record<string, (...args: any[]) => any>

export interface ElectrumBridge {
  invoke: (channel: string, ...args: unknown[]) => Promise<unknown>
  on: (channel: string, listener: (...args: unknown[]) => void) => () => void
  send: (channel: string, ...args: unknown[]) => void
}

type ChannelPrefix<T extends string> = T extends `${infer P}:${string}` ? P : never
type ChannelMethod<T extends string, P extends string> = T extends `${P}:${infer M}`
  ? M
  : never

/** `'user:list' | 'file:read'` → `{ user: { list: ... }, file: { read: ... } }` */
export type NestedIpcClient<T extends IpcApiMap> = {
  [P in ChannelPrefix<keyof T & string>]: {
    [M in ChannelMethod<keyof T & string, P>]: T[Extract<
      keyof T,
      `${P}:${M}`
    >]
  }
}

export type ElectrumClient<T extends IpcApiMap = IpcApiMap> = {
  invoke: <K extends keyof T & string>(
    channel: K,
    ...args: Parameters<T[K]>
  ) => ReturnType<T[K]>
  on: (channel: string, listener: (...args: any[]) => void) => () => void
  send: (channel: string, ...args: any[]) => void
} & Omit<NestedIpcClient<T>, 'invoke' | 'on' | 'send'>


export interface CreateClientOptions {
  /** window 上的键，默认 `api`（与 @electrum/preload exposeApi 一致） */
  key?: string
  /** 测试或自定义时注入桥，默认读 window[key] */
  bridge?: ElectrumBridge
}
