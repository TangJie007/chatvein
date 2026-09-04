import { Injectable, Inject, NotFoundException, ValidationException } from '@electrum/common'
import {
  createReactChatAgent,
  getDefaultHeuristicRouter,
  invokeReactChatAgent,
} from '@chatvein/agents'
import type { ComplexityBand, RouteDecision } from '@chatvein/common'
import { createLangChainChatModel } from '@chatvein/models'
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
} from './chat.types'

@Injectable()
export class ChatService {
  @Inject(ChatStore)
  private store!: ChatStore

  @Inject(AgentService)
  private agents!: AgentService

  @Inject(ModelService)
  private models!: ModelService

  private lastBandByConv = new Map<string, ComplexityBand>()

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
    this.lastBandByConv.delete(id)
    await this.store.save(data)
    return { ok: true }
  }

  /**
   * 普通对话：L1/L1.5 启发式路由 → Agent → Model → `@chatvein/agents` ReAct。
   * 工具白名单尚未落地时 tools=[]；路由 policy 供后续裁剪与 UI 提示。
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

    const runId = randomUUID()
    emit?.({
      type: 'run_start',
      runId,
      conversationId: conv.id,
      agent: agent.name,
      ts: Date.now(),
    })

    const route = await getDefaultHeuristicRouter().route({
      text: content,
      session: {
        turnIndex: history.filter((m) => m.role === 'user').length,
        lastBand: this.lastBandByConv.get(conv.id),
        lastAssistantHadTools: false,
        recentFailure: false,
        activeMode: 'chat',
      },
    })
    this.lastBandByConv.set(conv.id, route.band)

    emit?.({
      type: 'route',
      runId,
      conversationId: conv.id,
      decision: route,
    })
    emit?.({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: formatRouteThinking(route),
    })

    if (route.terminal?.kind === 'slash') {
      const cmd = String(route.terminal.payload?.slashCmd ?? '')
      const text = `已识别命令 /${cmd}（本地处理占位；尚未绑定具体动作）。`
      emit?.({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.persistAssistant(data, idx, conv, agentId, userMessage, text, 0, model.model, route)
    }

    emit?.({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: 'ReAct 运行中（@chatvein/agents）…\n',
    })

    const llm = createLangChainChatModel({
      id: model.id,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: model.temperature,
      maxTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
    })

    const reactAgent = createReactChatAgent({
      model: llm,
      tools: [],
      systemPrompt: agent.systemPrompt?.trim() || undefined,
      name: agent.name,
    })

    const started = Date.now()
    let text: string
    try {
      const result = await invokeReactChatAgent(reactAgent, {
        message: content,
        history,
        recursionLimit: Math.max(1, route.policy.maxSteps || 25),
      })
      text = result.content.trim()
    } catch (err) {
      emit?.({ type: 'thinking_done', runId, conversationId: conv.id })
      throw new ValidationException(formatAgentError(err), [])
    }
    const latencyMs = Date.now() - started
    emit?.({ type: 'thinking_done', runId, conversationId: conv.id })

    if (!text) throw new ValidationException('模型返回空内容', [])

    return this.persistAssistant(
      data,
      idx,
      conv,
      agentId,
      userMessage,
      text,
      latencyMs,
      model.model,
      route,
    )
  }

  private async persistAssistant(
    data: Awaited<ReturnType<ChatStore['load']>>,
    idx: number,
    conv: Conversation,
    agentId: string,
    userMessage: ChatMessage,
    text: string,
    latencyMs: number,
    modelId: string,
    route: RouteDecision,
  ): Promise<ChatSendResult> {
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
    }

    const title =
      conv.messages.length === 0 && conv.title === '新对话'
        ? truncateTitle(userMessage.content)
        : conv.title

    const next: Conversation = {
      ...conv,
      title,
      agentId,
      messages: [...conv.messages, userMessage, assistantMessage],
      updatedAt: Date.now(),
    }
    data.conversations[idx] = next
    data.conversations.splice(idx, 1)
    data.conversations.unshift(next)
    await this.store.save(data)

    return {
      conversation: next,
      userMessage,
      assistantMessage,
      latencyMs,
      model: modelId,
      route,
    }
  }
}

function formatRouteThinking(route: RouteDecision): string {
  const hints: string[] = []
  if (route.policy.hintUserCreateGroup) hints.push('可提示用户拉群')
  if (route.policy.hintUserForge) hints.push('可提示派 Forge')
  if (route.policy.allowSubAgents) hints.push('允许子 Agent')
  const hintStr = hints.length ? `；${hints.join('、')}` : ''
  return `路由 L1：band=${route.band} score=${route.score} tier=${route.policy.modelTier} tools=${route.policy.tools}（${route.reasons.slice(0, 4).join(', ') || '—'}）${hintStr}\n`
}

function truncateTitle(text: string): string {
  const one = text.replace(/\s+/g, ' ').trim()
  return one.length <= 28 ? one : `${one.slice(0, 28)}…`
}

function formatAgentError(err: unknown): string {
  const msg = err instanceof Error ? err.message : String(err)
  if (/abort|timeout/i.test(msg)) return '模型调用超时'
  if (/401|unauthorized|invalid.*key/i.test(msg)) return '鉴权失败：API Key 无效'
  if (/ENOTFOUND|ECONNREFUSED|fetch failed|network/i.test(msg)) {
    return `无法连接模型：${msg}`
  }
  return `对话失败：${msg.slice(0, 200)}`
}
