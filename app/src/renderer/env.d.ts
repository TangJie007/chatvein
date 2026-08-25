/// <reference types="vite/client" />

import type { IpcApi } from './ipc-api'

interface ElectronAPI {
  invoke: <K extends keyof IpcApi>(
    channel: K,
    ...args: Parameters<IpcApi[K]>
  ) => ReturnType<IpcApi[K]>
  on: (channel: string, listener: (...args: any[]) => void) => () => void
  send: (channel: string, ...args: any[]) => void
}

declare global {
  interface Window {
    api: ElectronAPI
  }
}

declare module '*.vue' {
  import type { DefineComponent } from 'vue'
  const component: DefineComponent<object, object, unknown>
  export default component
}

export {}
