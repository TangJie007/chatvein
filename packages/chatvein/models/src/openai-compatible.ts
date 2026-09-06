import {
  ModelError,
  ValidationError,
  emptyTokenUsage,
  type ChatMessage,
  type ChatModelLike,
  type ModelInvokeOptions,
  type ModelResult,
  type TokenUsage,
} from '@chatvein/common'
import { emitTelemetry } from '@chatvein/observability'
import { randomUUID } from 'node:crypto'

export interface OpenAICompatibleConfig {
  id: string
  /** 不含尾斜杠，例如 https://api.openai.com/v1 */
  baseUrl: string
  apiKey?: string
  model: string
  temperature?: number
  maxTokens?: number
  defaultTimeoutMs?: number
}

/**
 * OpenAI 兼容 /chat/completions 直连实现（不经 LangChain）。
 * 关键路径可测、可绕过框架，符合 R1。
 */
export class OpenAICompatibleChatModel implements ChatModelLike {
  readonly id: string

  constructor(private readonly config: OpenAICompatibleConfig) {
    if (!config.baseUrl?.trim()) throw new ValidationError('baseUrl 不能为空')
    if (!config.model?.trim()) throw new ValidationError('model 不能为空')
    this.id = config.id
  }

  async invoke(messages: ChatMessage[], opts: ModelInvokeOptions = {}): Promise<ModelResult> {
    if (!messages.length) throw new ValidationError('messages 不能为空')

    const base = this.config.baseUrl.trim().replace(/\/+$/, '')
    const url = `${base}/chat/completions`
    const maxTokens = opts.maxTokens ?? this.config.maxTokens ?? 0
    const body: Record<string, unknown> = {
      model: this.config.model,
      messages: messages.map((m) => ({ role: m.role, content: m.content })),
      temperature: opts.temperature ?? this.config.temperature ?? 0.2,
      stream: false,
    }
    if (maxTokens > 0) body.max_tokens = maxTokens

    const timeoutMs = opts.timeoutMs ?? this.config.defaultTimeoutMs ?? 120_000
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    opts.signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), timeoutMs)

    const spanId = randomUUID()
    const started = Date.now()
    const attrs: Record<string, unknown> = {
      source: 'openai-compatible',
      modelId: this.id,
      model: this.config.model,
    }
    this.emitTelemetry('llm:request', spanId, { messages: body.messages }, { attrs })
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(this.config.apiKey ? { Authorization: `Bearer ${this.config.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      })
      const latencyMs = Date.now() - started
      if (!res.ok) {
        const detail = await safeErrorText(res)
        throw new ModelError(
          res.status === 401
            ? '鉴权失败：API Key 无效'
            : `模型调用失败 HTTP ${res.status}${detail ? ` · ${detail}` : ''}`,
          res.status === 429 ? 'MODEL_RATE_LIMIT' : 'MODEL_HTTP',
        )
      }

      const json = (await res.json()) as {
        model?: string
        choices?: Array<{ message?: { content?: string | null } }>
        usage?: {
          prompt_tokens?: number
          completion_tokens?: number
          total_tokens?: number
        }
      }
      const content = json.choices?.[0]?.message?.content?.trim() ?? ''
      if (!content) throw new ModelError('模型返回空内容', 'MODEL_EMPTY')

      const result: ModelResult = {
        content,
        usage: parseUsage(json.usage),
        model: json.model || this.config.model,
        latencyMs,
      }
      this.emitTelemetry(
        'llm:response',
        spanId,
        { raw: json, result },
        {
          status: 'ok',
          durationMs: latencyMs,
          attrs: { ...attrs, responseModel: result.model, tokens: result.usage },
        },
      )
      return result
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      this.emitTelemetry(
        'llm:error',
        spanId,
        { name: (err as Error)?.name, message },
        {
          status: 'error',
          error: message,
          durationMs: Date.now() - started,
          attrs,
        },
      )
      if (err instanceof ModelError || err instanceof ValidationError) throw err
      const aborted = err instanceof Error && err.name === 'AbortError'
      throw new ModelError(
        aborted ? `模型调用超时（${timeoutMs}ms）` : `无法连接模型：${message}`,
        aborted ? 'MODEL_TIMEOUT' : 'MODEL_NETWORK',
      )
    } finally {
      clearTimeout(timer)
      opts.signal?.removeEventListener('abort', onAbort)
    }
  }

  /** 异步发遥测，绝不阻塞/影响模型调用 */
  private emitTelemetry(
    name: string,
    spanId: string,
    payload: Record<string, unknown>,
    opts?: {
      status?: 'ok' | 'error'
      durationMs?: number
      attrs?: Record<string, unknown>
      error?: string
    },
  ): void {
    setImmediate(() => {
      try {
        emitTelemetry(name, payload, { spanId, ...opts })
      } catch {
        // 遥测不得影响对话
      }
    })
  }
}

function parseUsage(raw?: {
  prompt_tokens?: number
  completion_tokens?: number
  total_tokens?: number
}): TokenUsage {
  if (!raw) return emptyTokenUsage()
  const promptTokens = Number(raw.prompt_tokens) || 0
  const completionTokens = Number(raw.completion_tokens) || 0
  const totalTokens = Number(raw.total_tokens) || promptTokens + completionTokens
  return { promptTokens, completionTokens, totalTokens }
}

async function safeErrorText(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: { message?: string } }
    return body?.error?.message?.slice(0, 160) ?? ''
  } catch {
    try {
      return (await res.text()).slice(0, 160)
    } catch {
      return ''
    }
  }
}
