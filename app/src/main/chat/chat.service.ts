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
  Conversation,
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
   */
  async send(input: ChatSendInput): Promise<ChatSendResult> {
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

    const { text, latencyMs } = await this.complete({
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: model.temperature,
      maxTokens: model.maxTokens,
      messages: apiMessages,
    })

    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
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
  }): Promise<{ text: string; latencyMs: number }> {
    const base = input.baseUrl.trim().replace(/\/+$/, '')
    const url = `${base}/chat/completions`
    const body: Record<string, unknown> = {
      model: input.model,
      messages: input.messages,
      temperature: input.temperature,
      stream: false,
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
      const latencyMs = Date.now() - started
      if (!res.ok) {
        const detail = await safeErrorText(res)
        throw new ValidationException(
          res.status === 401
            ? '鉴权失败：API Key 无效'
            : `模型调用失败 HTTP ${res.status}${detail ? ` · ${detail}` : ''}`,
          [],
        )
      }
      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string | null }; finish_reason?: string }>
      }
      const text = json.choices?.[0]?.message?.content?.trim() ?? ''
      if (!text) throw new ValidationException('模型返回空内容', [])
      return { text, latencyMs }
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
