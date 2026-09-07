export type ChatRole = 'user' | 'assistant' | 'system'

/** OpenAI 兼容接口返回的 token 用量 */
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
  /** 仅 assistant 消息；部分供应商可能不回传 */
  usage?: TokenUsage
  /** 本轮生成耗时（ms）；仅 assistant */
  latencyMs?: number
  /** 助手回复失败占位；可触发重试，用户消息仍保留 */
  failed?: boolean
}

export interface Conversation {
  id: string
  /** 会话标题（默认取首条用户消息截断） */
  title: string
  /** 绑定的 Agent id，一期默认主对话 Agent */
  agentId: string
  /** 本会话工作区绝对路径：settings.workspaceRoot / {slug} */
  workspacePath: string
  /** 本会话沙箱绝对路径：workspacePath / runs */
  sandboxPath: string
  /** 目录名 slug（时间戳） */
  slug: string
  messages: ChatMessage[]
  createdAt: number
  updatedAt: number
}

export interface ChatStoreFile {
  version: 1
  conversations: Conversation[]
}

export interface ChatSendInput {
  conversationId: string
  content: string
  /** 不传则用会话已绑定 agentId */
  agentId?: string
  /**
   * 工作模式：office/custom → Chat ReAct；code → Forge orchestrator。
   * 缺省 office。
   */
  workMode?: 'office' | 'code' | 'custom'
  /** 编程档：从上次 Forge checkpoint 续跑 */
  resumeForge?: boolean
}

export interface ChatRetryInput {
  conversationId: string
  /** 失败的助手消息 id */
  failedMessageId: string
  workMode?: 'office' | 'code' | 'custom'
  /** 编程档：从上次 Forge checkpoint 续跑 */
  resumeForge?: boolean
}

/**
 * 主进程 → 渲染进程的对话流事件（通道 `chat:event`）。
 *
 * 对话已切到 `@chatvein/agents`（同步 ReAct invoke）。思考面板一期推送
 * 运行状态提示；流式 reasoning / token（design/08）见 CP1-2。
 * 事件均带 `conversationId`，渲染层按当前会话过滤。
 */
/** 思考侧栏「产物」条目（与 ThinkingPanel.ThinkingArtifact 对齐） */
export interface ChatArtifactItem {
  id: string
  title: string
  kind?: string
  detail?: string
  /** 绝对路径；点击在资源管理器中显示 */
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
      /** 本轮工作区新增/改写的文件等 */
      type: 'artifacts'
      runId: string
      conversationId: string
      items: ChatArtifactItem[]
    }
  | {
      /** 统一遥测事件：llm:* 原始 IO / trace:* 编排度量，渲染进程 console.log */
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

export interface ChatSendResult {
  conversation: Conversation
  userMessage: ChatMessage
  assistantMessage: ChatMessage
  latencyMs: number
  model: string
  /** L1/L1.5 启发式路由结果 */
  route?: import('@chatvein/common').RouteDecision
  /** true：本轮助手为失败占位，用户消息已保留 */
  failed?: boolean
}
