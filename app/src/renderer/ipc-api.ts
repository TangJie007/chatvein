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

  // ---- 模型选型（OpenAI 兼容 · 一期）----
  'model:list': () => Promise<ModelConfig[]>
  'model:get': (id: string) => Promise<ModelConfig>
  'model:create': (input?: ModelInput) => Promise<ModelConfig>
  'model:update': (data: { id: string; patch: ModelInput }) => Promise<ModelConfig>
  'model:remove': (id: string) => Promise<{ ok: true }>
  'model:presets': () => Promise<ProviderPreset[]>
  'model:test': (data: { baseUrl: string; apiKey: string; model: string }) => Promise<ConnectionTestResult>

  // ---- Agent 配置（绑定 modelId）----
  'agent:list': () => Promise<AgentConfig[]>
  'agent:get': (id: string) => Promise<AgentConfig>
  'agent:create': (input?: AgentInput) => Promise<AgentConfig>
  'agent:update': (data: { id: string; patch: AgentInput }) => Promise<AgentConfig>
  'agent:remove': (id: string) => Promise<{ ok: true }>
}

export type UserRow = { id: number; name: string; email: string }

// ---- 模型选型 ----------------------------------------------------------

export interface ModelConfig {
  id: string
  name: string
  protocol: 'openai'
  provider: string
  baseUrl: string
  apiKey: string
  model: string
  temperature: number
  maxTokens: number
  enabled: boolean
  createdAt: number
  updatedAt: number
}

export interface ModelInput {
  name?: string
  provider?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  temperature?: number
  maxTokens?: number
  enabled?: boolean
}

export interface ProviderPreset {
  value: string
  label: string
  baseUrl: string
  models: string[]
}

export interface ConnectionTestResult {
  ok: boolean
  latencyMs: number
  message: string
  model?: string
}

// ---- Agent 配置 ----------------------------------------------------------

export type AvatarTint =
  | 'indigo'
  | 'sky'
  | 'peach'
  | 'clay'
  | 'rose'
  | 'slate'
  | 'teal'
  | 'violet'

export interface AgentConfig {
  id: string
  isMain?: boolean
  name: string
  role: string
  desc: string
  initial: string
  tint: AvatarTint
  modelId: string
  enabled: boolean
  tools: string[]
  skills: string[]
  knowledgeBases: string[]
  systemPrompt: string
  createdAt: number
  updatedAt: number
}

/** 渲染端提交的可编辑字段（id / isMain / 时间戳由主进程管理） */
export interface AgentInput {
  name?: string
  role?: string
  desc?: string
  initial?: string
  tint?: AvatarTint
  modelId?: string
  enabled?: boolean
  tools?: string[]
  skills?: string[]
  knowledgeBases?: string[]
  systemPrompt?: string
}
