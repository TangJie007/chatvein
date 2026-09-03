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
}

export interface Conversation {
  id: string
  /** 会话标题（默认取首条用户消息截断） */
  title: string
  /** 绑定的 Agent id，一期默认主对话 Agent */
  agentId: string
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
}

/**
 * 主进程 → 渲染进程的对话流事件（通道 `chat:event`）。
 *
 * 对话已切到 `@chatvein/agents`（同步 ReAct invoke）。思考面板一期推送
 * 运行状态提示；流式 reasoning / token（design/08）见 CP1-2。
 * 事件均带 `conversationId`，渲染层按当前会话过滤。
 */
export type ChatStreamEvent =
  | { type: 'run_start'; runId: string; conversationId: string; agent: string; ts: number }
  | { type: 'thinking_delta'; runId: string; conversationId: string; delta: string }
  | { type: 'thinking_done'; runId: string; conversationId: string }

export interface ChatSendResult {
  conversation: Conversation
  userMessage: ChatMessage
  assistantMessage: ChatMessage
  latencyMs: number
  model: string
}
