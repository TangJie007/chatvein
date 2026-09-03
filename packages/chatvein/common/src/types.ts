/** 单次调用用量（与 OpenAI usage 字段对齐的语义） */
export interface TokenUsage {
  promptTokens: number
  completionTokens: number
  totalTokens: number
}

/** 按模型累计；total 为各模型之和 */
export interface TokenStat {
  byModel: Record<string, TokenUsage>
  total: TokenUsage
}

export function emptyTokenUsage(): TokenUsage {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
}

export function emptyTokenStat(): TokenStat {
  return { byModel: {}, total: emptyTokenUsage() }
}

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    promptTokens: a.promptTokens + b.promptTokens,
    completionTokens: a.completionTokens + b.completionTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

/** 运行级护栏阈值；判定逻辑在 @chatvein/context */
export interface Budget {
  maxTokens: number
  maxSteps: number
  maxWallClockMs: number
  maxConsecutiveFailures: number
}

export const DEFAULT_BUDGET: Budget = {
  maxTokens: 8_000_000,
  maxSteps: 30,
  maxWallClockMs: 6 * 60 * 60 * 1000,
  maxConsecutiveFailures: 3,
}

export type ModelTier = 'strong' | 'medium' | 'weak'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export interface ChatMessage {
  role: ChatRole
  content: string
}

export interface ModelInvokeOptions {
  temperature?: number
  /** 0 / 省略 = 不传 max_tokens */
  maxTokens?: number
  signal?: AbortSignal
  timeoutMs?: number
}

export interface ModelResult {
  content: string
  usage: TokenUsage
  model: string
  latencyMs: number
}

/** 隔离 LangChain；能力包只依赖此接口 */
export interface ChatModelLike {
  readonly id: string
  invoke(messages: ChatMessage[], opts?: ModelInvokeOptions): Promise<ModelResult>
}

export type TraceEventKind =
  | 'model_call'
  | 'model_fallback'
  | 'tool_call'
  | 'budget'
  | 'run_status'
  | 'info'

export interface TraceEvent {
  id: string
  runId: string
  ts: number
  kind: TraceEventKind
  name?: string
  /** 小对象内联；过大时由 observability 落 payloadRef */
  payload?: Record<string, unknown>
  payloadRef?: string
  durationMs?: number
  error?: string
}
