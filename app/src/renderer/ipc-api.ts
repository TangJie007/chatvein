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
  /** 在系统文件管理器中打开并选中该文件 */
  'file:showInFolder': (path: string) => Promise<{ ok: true }>
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

  // ---- 普通对话 ----
  'chat:list': () => Promise<Conversation[]>
  'chat:get': (id: string) => Promise<Conversation>
  'chat:create': (input?: { title?: string; agentId?: string }) => Promise<Conversation>
  'chat:remove': (id: string) => Promise<{ ok: true }>
  'chat:send': (input: ChatSendInput) => Promise<ChatSendResult>
  'chat:retry': (input: ChatRetryInput) => Promise<ChatSendResult>
  'chat:listArtifacts': (conversationId: string) => Promise<ChatArtifactItem[]>
  'chat:removeArtifact': (data: {
    conversationId: string
    absPath: string
  }) => Promise<{ ok: true; absPath: string }>
  'chat:getThinkingLog': (data: {
    conversationId: string
    messageId: string
  }) => Promise<{ text: string | null }>

  // ---- 应用设置（路径 / 护栏）----
  'settings:get': () => Promise<AppSettingsView>
  'settings:update': (patch: AppSettingsPatch) => Promise<AppSettingsView>
  'settings:reset': () => Promise<AppSettingsView>
  'settings:pickFolder': (data?: { title?: string; defaultPath?: string }) => Promise<string | null>

  // ---- 向量数据库（数据集浏览器）----
  'vector:inspectTables': () => Promise<VectorTableInfo[]>
  'vector:browseTable': (name: string, limit?: number, offset?: number) => Promise<VectorBrowseResult>
  'vector:searchTable': (name: string, data: VectorSearchInput) => Promise<VectorSearchHit[]>
  /** 向量 + BM25 加权检索（与对话工具预筛 C1 相同的 RRF 融合，minScore 只过滤向量路） */
  'vector:hybridSearchTable': (name: string, data: VectorSearchInput) => Promise<VectorHybridSearchHit[]>
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
  /** 0 = 自动（不传 max_tokens） */
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

// ---- 应用设置 ----------------------------------------------------------

export interface AppSettingsView {
  version: 1
  workspaceRoot: string
  /** 编程开发模式的项目根目录（空字符串 = 未设置，回落到会话沙箱） */
  devProjectRoot: string
  cmdAllowlist: boolean
  confirmWrites: boolean
  reduceMotion: boolean
  effectiveWorkspaceRoot: string
  defaultWorkspaceRoot: string
}

export type AppSettingsPatch = Partial<
  Pick<
    AppSettingsView,
    'workspaceRoot' | 'devProjectRoot' | 'cmdAllowlist' | 'confirmWrites' | 'reduceMotion'
  >
>

// ---- 向量数据库（数据集浏览器）--------------------------------------------

export interface VectorTableColumn {
  name: string
  type: string
}
export interface VectorTableInfo {
  name: string
  count: number
  columns: VectorTableColumn[]
}
export interface VectorBrowseResult {
  total: number
  rows: Record<string, unknown>[]
}
/** 单条语义检索命中（结构对齐 @chatvein/vector 的 VectorSearchHit） */
export interface VectorSearchHit {
  id: string
  content: string
  summary: string | null
  /** 余弦相似度 ≈ score，范围 [-1,1]；≥0.2 视为弱相关以上 */
  score: number
  scope: string
  ownerId: string
  kind: string
  meta: Record<string, unknown>
}
export interface VectorSearchInput {
  query: string
  /** 召回上限；省略或 ≤0 时以表总行数为上限（返回全部 ≥ minScore 的记录） */
  topK?: number
  /** 相似度下限：score < minScore 的命中直接丢弃（默认建议 0.2） */
  minScore?: number
}
/** 向量 + BM25 加权命中：两路分 + RRF 融合分（对齐工具预筛 C1） */
export interface VectorHybridSearchHit {
  id: string
  content: string
  summary: string | null
  scope: string
  ownerId: string
  kind: string
  meta: Record<string, unknown>
  /** 余弦相似度；该行未达向量路阈值时为 null */
  vectorScore: number | null
  /** BM25 词法得分（工具名/别名/title）；词法路未命中时为 null */
  bm25Score: number | null
  /** RRF 融合权重分（返回已按降序） */
  fusedScore: number
  /** 命中来源 */
  sources: Array<'vector' | 'bm25'>
}

// ---- 普通对话 ----------------------------------------------------------

export type ChatRole = 'user' | 'assistant' | 'system'

export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

export interface ChatMessage {
  id: string
  role: ChatRole
  content: string
  createdAt: number
  usage?: TokenUsage
  /** 本轮生成耗时（ms）；仅 assistant */
  latencyMs?: number
  /** 助手回复失败占位；可触发重试 */
  failed?: boolean
}

export interface Conversation {
  id: string
  title: string
  agentId: string
  workspacePath: string
  sandboxPath: string
  slug: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface ChatSendInput {
  conversationId: string
  content: string
  agentId?: string
}

export interface ChatRetryInput {
  conversationId: string
  failedMessageId: string
}

export interface ChatSendResult {
  conversation: Conversation
  userMessage: ChatMessage
  assistantMessage: ChatMessage
  latencyMs: number
  model: string
  route?: import('@chatvein/common').RouteDecision
  failed?: boolean
}

/**
 * 主进程 → 渲染进程的对话流事件（通道 `chat:event`，经 `api.on('chat:event', ...)` 订阅）。
 * 一期承载思考过程：reasoning 增量逐块推送，渲染层思考面板消费。
 * 与主进程 chat.types.ts 的 ChatStreamEvent 保持一致。
 */
export interface ChatArtifactItem {
  id: string
  title: string
  kind?: string
  detail?: string
  absPath?: string
}

export type ChatStreamEvent =
  | { type: 'run_start'; runId: string; conversationId: string; agent: string; ts: number }
  | { type: 'thinking_delta'; runId: string; conversationId: string; delta: string }
  | { type: 'thinking_done'; runId: string; conversationId: string }
  | {
      type: 'route'
      runId: string
      conversationId: string
      decision: import('@chatvein/common').RouteDecision
    }
  | {
      type: 'artifacts'
      runId: string
      conversationId: string
      items: ChatArtifactItem[]
    }
  | {
      type: 'telemetry'
      event: {
        id: string
        name: string
        ts: number
        traceId?: string
        spanId?: string
        parentSpanId?: string
        status?: 'ok' | 'error'
        durationMs?: number
        attrs?: Record<string, unknown>
        payload?: Record<string, unknown>
        error?: string
      }
    }
