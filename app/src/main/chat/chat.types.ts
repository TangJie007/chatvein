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
 * 一期只承载「思考过程」：主进程以流式 SSE 调模型，把 reasoning
 * （DeepSeek `reasoning_content` / OpenAI 兼容 `reasoning`）逐块推给
 * 渲染层的思考面板。正文 token 流式（Markdown）见 docs/design/08，后续接入。
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
