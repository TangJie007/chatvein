export interface DoubaoMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
}

export interface DoubaoDiagnostic {
  url: string
  title: string
  bodyText: string
  hasInput: boolean
  hasTextarea: boolean
  hasContentEditable: boolean
  pageHint: string
}

export type DoubaoStatus = 'idle' | 'connecting' | 'ready' | 'generating' | 'error'

export interface IpcApi {
  'app:info': () => Promise<{
    name: string
    version: string
    electron: string
    chrome: string
    node: string
    platform: string
    demoFile: string
  }>
  'app:ping': (message: string) => Promise<{ echo: string; at: number }>
  'file:read': (path: string) => Promise<string>
  'file:write': (data: { path: string; content: string }) => Promise<{ ok: true; path: string }>
  'user:list': () => Promise<Array<{ id: number; name: string; email: string }>>
  'user:get': (id: number) => Promise<{ id: number; name: string; email: string }>
  'user:create': (data: {
    name: string
    email: string
  }) => Promise<{ id: number; name: string; email: string }>
  'user:update': (data: {
    id: number
    name?: string
    email?: string
  }) => Promise<{ id: number; name: string; email: string }>
  'user:remove': (id: number) => Promise<{ ok: true }>
  'window:minimize': () => Promise<void>
  'window:toggleMaximize': () => Promise<boolean>
  'window:isMaximized': () => Promise<boolean>
  'window:close': () => Promise<void>
  'window:openChild': (data?: { title?: string }) => Promise<{ id: number; title: string }>
  'window:list': () => Promise<Array<{ id: number; title: string; focused: boolean }>>
  'window:focus': (id: number) => Promise<boolean>
  'window:reloadMenu': () => Promise<{ ok: true }>
  'doubao:connect': () => Promise<{ status: DoubaoStatus; preloadPath: string }>
  'doubao:disconnect': () => Promise<void>
  'doubao:status': () => Promise<{ status: DoubaoStatus; hasWebview: boolean }>
  'doubao:diagnose': () => Promise<DoubaoDiagnostic>
  'doubao:send': (data: {
    prompt: string
    waitForCompletion?: boolean
  }) => Promise<{
    ok: boolean
    error?: string
    messages?: DoubaoMessage[]
    xml?: string
  }>
  'doubao:messages': () => Promise<DoubaoMessage[]>
  'doubao:extract': () => Promise<string>
}

export type NavView = 'dashboard' | 'users' | 'files' | 'windows' | 'doubao'

export type UserRow = { id: number; name: string; email: string }
