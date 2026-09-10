/// <reference types="vite/client" />

import type { IpcApi } from '@/api/ipc-api'

interface ElectronAPI {
  invoke: <K extends keyof IpcApi>(
    channel: K,
    ...args: Parameters<IpcApi[K]>
  ) => ReturnType<IpcApi[K]>
  on: (channel: string, listener: (...args: any[]) => void) => () => void
  send: (channel: string, ...args: any[]) => void
}

/** preload 暴露：拖放文件时取真实本地路径（Electron webUtils） */
interface FileApi {
  getPathForFile(file: File): string
}

declare global {
  interface Window {
    api: ElectronAPI
    fileApi: FileApi
  }
}

export {}
