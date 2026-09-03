import { Injectable, Inject, NotFoundException, ValidationException } from '@electrum/common'
import { randomUUID } from 'node:crypto'
import { AgentService } from '../agent/agent.service'
import { MAIN_AGENT_ID } from '../agent/agent.types'
import { ModelService } from '../model/model.service'
import { ChatStore } from './chat.store'
import type {
  ChatMessage,
  ChatSendInput,
  ChatSendResult,
  ChatStreamEvent,
  Conversation,
  TokenUsage,
} from './chat.types'

@Injectable()
export class ChatService {
  @Inject(ChatStore)
  private store!: ChatStore

  @Inject(AgentService)
  private agents!: AgentService

  @Inject(ModelService)
  private models!: ModelService

  async list(): Promise<Conversation[]> {
    const data = await this.store.load()
    return [...data.conversations].sort((a, b) => b.updatedAt - a.updatedAt)
  }

  async get(id: string): Promise<Conversation> {
    const data = await this.store.load()
    const conv = data.conversations.find((c) => c.id === id)
    if (!conv) throw new NotFoundException(`conversation:${id}`)
    return conv
  }

  async create(input?: { title?: string; agentId?: string }): Promise<Conversation> {
    const data = await this.store.load()
    const now = Date.now()
    const agentId = input?.agentId || MAIN_AGENT_ID
    // 校验 agent 存在
    await this.agents.get(agentId)
    const conv: Conversation = {
      id: randomUUID(),
      title: input?.title?.trim() || '新对话',
      agentId,
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    data.conversations.unshift(conv)
    await this.store.save(data)
    return conv
  }

  async remove(id: string): Promise<{ ok: true }> {
    const data = await this.store.load()
    const idx = data.conversations.findIndex((c) => c.id === id)
    if (idx === -1) throw new NotFoundException(`conversation:${id}`)
    data.conversations.splice(idx, 1)
    await this.store.save(data)
    return { ok: true }
  }

  /**
   * 普通对话：解析 Agent → Model，拼 system + 历史 + 用户消息，调 OpenAI 兼容接口。
   * 一期不做工具 / ReAct，仅单轮补全。
   *
   * `emit`（可选）用于把流式思考事件推给渲染层思考面板；不传则退化为无事件。
   */
  async send(
    input: ChatSendInput,
    emit?: (evt: ChatStreamEvent) => void,
  ): Promise<ChatSendResult> {
    const content = (input.content || '').trim()
    if (!content) throw new ValidationException('消息不能为空', [])

    const data = await this.store.load()
    const idx = data.conversations.findIndex((c) => c.id === input.conversationId)
    if (idx === -1) throw new NotFoundException(`conversation:${input.conversationId}`)
    const conv = data.conversations[idx]

    const agentId = input.agentId || conv.agentId || MAIN_AGENT_ID
    const agent = await this.agents.get(agentId)
    if (!agent.enabled) throw new ValidationException(`Agent「${agent.name}」已停用`, [])
    if (!agent.modelId) {
      throw new ValidationException(`Agent「${agent.name}」未绑定模型，请先在 Agents 中选用模型`, [])
    }

    const model = await this.models.get(agent.modelId)
    if (!model.enabled) throw new ValidationException(`模型「${model.name}」已停用`, [])
    if (!model.baseUrl?.trim()) throw new ValidationException('模型 Base URL 为空', [])
    if (!model.model?.trim()) throw new ValidationException('模型 ID 为空', [])

    const now = Date.now()
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      content,
      createdAt: now,
    }

    const history = conv.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    const apiMessages: Array<{ role: string; content: string }> = []
    if (agent.systemPrompt?.trim()) {
      apiMessages.push({ role: 'system', content: agent.systemPrompt.trim() })
    }
    apiMessages.push(...history, { role: 'user', content })

    const runId = randomUUID()
    emit?.({
      type: 'run_start',
      runId,
      conversationId: conv.id,
      agent: agent.name,
      ts: Date.now(),
    })

    let reasoning = ''
    let thinkingEnded = false
    const endThinking = () => {
      if (thinkingEnded || !emit) return
      thinkingEnded = true
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
    }
    const { text, latencyMs, usage } = await this.complete({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      messages: apiMessages,
      onReasoning: emit
        ? (delta) => {
            reasoning += delta
            emit({ type: 'thinking_delta', runId, conversationId: conv.id, delta })
          }
        : undefined,
      // 正文首块到达即结束「思考中」阶段（非推理模型也会立即切到生成正文）
      onContentStart: emit ? endThinking : undefined,
    })
    endThinking()

    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
      ...(usage ? { usage } : {}),
    }

    const title =
      conv.messages.length === 0 && conv.title === '新对话'
        ? truncateTitle(content)
        : conv.title

    const next: Conversation = {
      ...conv,
      title,
      agentId,
      messages: [...conv.messages, userMessage, assistantMessage],
      updatedAt: Date.now(),
    }
    data.conversations[idx] = next
    // 更新后排到前面
    data.conversations.splice(idx, 1)
    data.conversations.unshift(next)
    await this.store.save(data)

    return {
      conversation: next,
      userMessage,
      assistantMessage,
      latencyMs,
      model: model.model,
    }
  }

  private async complete(input: {
    baseUrl: string
    apiKey: string
    model: string
    temperature: number
    maxTokens: number
    messages: Array<{ role: string; content: string }>
    /** 思考过程增量回调（reasoning_content / reasoning），用于思考面板 */
    onReasoning?: (delta: string) => void
    /** 正文首块到达回调（标志思考阶段结束） */
    onContentStart?: () => void
  }): Promise<{ text: string; latencyMs: number; usage?: TokenUsage }> {
    const base = input.baseUrl.trim().replace(/\/+$/, '')
    const url = `${base}/chat/completions`
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      // 流式：拿 reasoning 增量喂思考面板；正文一期仍累积后整体返回
      stream: true,
    }
    // 0 = 自动：不传 max_tokens
    if (input.maxTokens > 0) body.max_tokens = input.maxTokens

    const started = Date.now()
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 120_000)
    try {
      const res = await fetch(url, {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'Content-Type': 'application/json',
          ...(input.apiKey ? { Authorization: `Bearer ${input.apiKey}` } : {}),
        },
        body: JSON.stringify(body),
      })
      if (!res.ok || !res.body) {
        const detail = await safeErrorText(res)
        throw new ValidationException(
          res.status === 401
            ? '鉴权失败：API Key 无效'
            : `模型调用失败 HTTP ${res.status}${detail ? ` · ${detail}` : ''}`,
          [],
        )
      }

      let content = ''
      let reasoning = ''
      let usage: TokenUsage | undefined
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      const handleLine = (line: string): void => {
        const trimmed = line.trim()
        if (!trimmed.startsWith('data:')) return
        const payload = trimmed.slice(5).trim()
        if (!payload || payload === '[DONE]') return
        let chunk: {
          choices?: Array<{
            delta?: {
              content?: string | null
              reasoning_content?: string | null
              reasoning?: string | null
            }
          }>
          usage?: {
            prompt_tokens?: number
            completion_tokens?: number
            total_tokens?: number
          }
        }
        try {
          chunk = JSON.parse(payload)
        } catch {
          return // 半包/非 JSON，跳过
        }
        const delta = chunk.choices?.[0]?.delta
        if (delta?.content) {
          if (!content) input.onContentStart?.()
          content += delta.content
        }
        const think = delta?.reasoning_content ?? delta?.reasoning
        if (think) {
          reasoning += think
          input.onReasoning?.(think)
        }
        if (chunk.usage) usage = parseUsage(chunk.usage)
      }

      // SSE：按行解析 `data: {...}`，`[DONE]` 结束
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        let nl: number
        // 以换行分隔事件；逐行处理
        while ((nl = buffer.indexOf('\n')) !== -1) {
          handleLine(buffer.slice(0, nl))
          buffer = buffer.slice(nl + 1)
        }
      }
      // 流末尾可能残留一行（无结尾换行）
      if (buffer.trim()) handleLine(buffer)

      const latencyMs = Date.now() - started
      const text = content.trim()
      if (!text) {
        // 有思考无正文（如纯推理被截断）也给出明确提示
        throw new ValidationException(
          reasoning ? '模型仅返回思考过程、无正文内容' : '模型返回空内容',
          [],
        )
      }
      return { text, latencyMs, usage }
    } catch (err) {
      if (err instanceof ValidationException) throw err
      const aborted = err instanceof Error && err.name === 'AbortError'
      throw new ValidationException(
        aborted ? '模型调用超时（120s）' : `无法连接模型：${(err as Error).message}`,
        [],
      )
    } finally {
      clearTimeout(timer)
    }
  }
}

function truncateTitle(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= 28 ? one : `${one.slice(0, 28)}…`
}

function parseUsage(
  raw?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number },
): TokenUsage | undefined {
  if (!raw) return undefined
  const promptTokens = Number(raw.prompt_tokens) || 0
  const completionTokens = Number(raw.completion_tokens) || 0
  const totalTokens = Number(raw.total_tokens) || promptTokens + completionTokens
  if (totalTokens <= 0 && promptTokens <= 0 && completionTokens <= 0) return undefined
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
