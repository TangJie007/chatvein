import { Injectable, Inject, NotFoundException, ValidationException } from '@electrum/common'
import {
  createL2Classifier,
  createReactChatAgent,
  getDefaultHeuristicRouter,
  invokeReactChatAgent,
} from '@chatvein/agents'
import type { ComplexityBand, RouteDecision } from '@chatvein/common'
import {
  createLangChainChatModel,
  isLlmDebugLogEnabled,
  safeJsonStringify,
} from '@chatvein/models'
import { randomUUID } from 'node:crypto'
import { AgentService } from '../agent/agent.service'
import { MAIN_AGENT_ID } from '../agent/agent.types'
import { ModelService } from '../model/model.service'
import type { ModelConfig } from '../model/model.types'
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
  /** 已为该模型 id 注入过 Structured L2，避免每轮重建 */
  private l2BoundModelId: string | null = null

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
   * 普通对话：L1/L1.5 →（灰区）L2 结构化分类 → Agent ReAct。
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

    // L1 →（灰区）L2 结构化分类 → ReAct；L2 用弱模偏好，无分档表时回退当前 Agent 模型
    const router = await this.routerWithL2(model)
    const route = await router.route({
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

    if (route.terminal?.kind === 'empty') {
      const text = '（空消息，已忽略）'
      emit?.({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.persistAssistant(data, idx, conv, agentId, userMessage, text, 0, model.model, route)
    }

    // —— 吃满 L1 policy（开发验证）——
    const maxSteps = route.policy.maxSteps
    const toolPolicy = route.policy.tools

    emit?.({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: formatPolicyApply(route),
    })

    // 仅寒暄 / 自我介绍规则允许本地短路；其它 maxSteps=0（如误判 trivial）仍走 LLM
    const allowLocalShortCircuit =
      maxSteps <= 0 &&
      (route.reasons.includes('greeting_only') || route.reasons.includes('self_intro'))

    if (allowLocalShortCircuit) {
      const text = localReplyForRoute(route, content)
      emit?.({
        type: 'thinking_delta',
        runId,
        conversationId: conv.id,
        delta: `执行：maxSteps=${maxSteps} → 本地短路，跳过 LLM\n`,
      })
      this.emitLlmDebug(emit, runId, conv.id, 'react:skipped', {
        reason: 'maxSteps<=0',
        route: {
          band: route.band,
          score: route.score,
          tools: route.policy.tools,
          modelTier: route.policy.modelTier,
          maxSteps,
        },
        localReply: text,
      })
      emit?.({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.persistAssistant(data, idx, conv, agentId, userMessage, text, 0, model.model, route)
    }

    const recursionLimit = Math.max(1, maxSteps)
    // modelTier：一期无分档模型表，仍用 Agent 绑定模型；weak 注入短回复约束
    const systemPrompt = systemPromptForTier(agent.systemPrompt, route.policy.modelTier)
    const llm = createLangChainChatModel({
      id: model.id,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: temperatureForTier(route.policy.modelTier, model.temperature),
      maxTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
    })

    const reactAgent = createReactChatAgent({
      model: llm,
      tools: [], // tools=none|unknown → 空；full 待白名单落地
      systemPrompt,
      name: agent.name,
    })

    const started = Date.now()
    let text: string
    try {
      this.emitLlmDebug(emit, runId, conv.id, 'react:request', {
        model: {
          id: model.id,
          name: model.name,
          model: model.model,
          baseUrl: model.baseUrl,
          temperature: temperatureForTier(route.policy.modelTier, model.temperature),
          maxTokens: model.maxTokens,
          requestedTier: route.policy.modelTier,
        },
        agent: { id: agent.id, name: agent.name },
        systemPrompt: systemPrompt ?? null,
        recursionLimit,
        toolsPolicy: toolPolicy,
        toolsBound: [],
        route: {
          band: route.band,
          score: route.score,
          tools: route.policy.tools,
          modelTier: route.policy.modelTier,
          maxSteps,
        },
        history,
        message: content,
      })

      const result = await invokeReactChatAgent(reactAgent, {
        message: content,
        history,
        recursionLimit,
      })
      text = result.content.trim()

      this.emitLlmDebug(emit, runId, conv.id, 'react:response', {
        content: result.content,
        messageCount: result.messages.length,
        messages: result.messages,
        latencyMs: Date.now() - started,
      })
    } catch (err) {
      emit?.({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.persistAssistant(
        data,
        idx,
        conv,
        agentId,
        userMessage,
        friendlyReplyFailure(formatAgentError(err)),
        Date.now() - started,
        model.model,
        route,
        true,
      )
    }
    const latencyMs = Date.now() - started
    emit?.({ type: 'thinking_done', runId, conversationId: conv.id })

    if (!text) {
      return this.persistAssistant(
        data,
        idx,
        conv,
        agentId,
        userMessage,
        friendlyReplyFailure('模型返回空内容'),
        latencyMs,
        model.model,
        route,
        true,
      )
    }

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

  /**
   * 重试失败的助手回复：保留原用户消息，去掉失败气泡后重新生成。
   */
  async retry(
    input: { conversationId: string; failedMessageId: string },
    emit?: (evt: ChatStreamEvent) => void,
  ): Promise<ChatSendResult> {
    const data = await this.store.load()
    const idx = data.conversations.findIndex((c) => c.id === input.conversationId)
    if (idx === -1) throw new NotFoundException(`conversation:${input.conversationId}`)
    let conv = data.conversations[idx]!

    const failIdx = conv.messages.findIndex((m) => m.id === input.failedMessageId)
    if (failIdx < 0) throw new NotFoundException(`message:${input.failedMessageId}`)
    const failed = conv.messages[failIdx]!
    if (failed.role !== 'assistant' || !failed.failed) {
      throw new ValidationException('只能重试失败的回复', [])
    }

    let userIdx = failIdx - 1
    while (userIdx >= 0 && conv.messages[userIdx]!.role !== 'user') userIdx--
    if (userIdx < 0) throw new ValidationException('找不到对应的用户消息', [])
    const userMessage = conv.messages[userIdx]!

    // 去掉失败气泡（及误跟在后面的内容）
    conv = {
      ...conv,
      messages: conv.messages.slice(0, failIdx),
      updatedAt: Date.now(),
    }
    data.conversations[idx] = conv
    await this.store.save(data)

    // 复用 send：以已落库用户消息内容再跑一轮（会话末尾已是该用户消息）
    return this.regenerateAfterUser(data, idx, conv, userMessage, emit)
  }

  /** 会话末尾已是 userMessage 时，只生成助手回复并追加 */
  private async regenerateAfterUser(
    data: Awaited<ReturnType<ChatStore['load']>>,
    idx: number,
    conv: Conversation,
    userMessage: ChatMessage,
    emit?: (evt: ChatStreamEvent) => void,
  ): Promise<ChatSendResult> {
    const agentId = conv.agentId || MAIN_AGENT_ID
    const agent = await this.agents.get(agentId)
    if (!agent.enabled) throw new ValidationException(`Agent「${agent.name}」已停用`, [])
    if (!agent.modelId) {
      throw new ValidationException(`Agent「${agent.name}」未绑定模型，请先在 Agents 中选用模型`, [])
    }
    const model = await this.models.get(agent.modelId)
    if (!model.enabled) throw new ValidationException(`模型「${model.name}」已停用`, [])
    if (!model.baseUrl?.trim()) throw new ValidationException('模型 Base URL 为空', [])
    if (!model.model?.trim()) throw new ValidationException('模型 ID 为空', [])

    const content = userMessage.content
    const history = conv.messages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .slice(0, -1)
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }))

    const runId = randomUUID()
    emit?.({
      type: 'run_start',
      runId,
      conversationId: conv.id,
      agent: agent.name,
      ts: Date.now(),
    })

    const router = await this.routerWithL2(model)
    const route = await router.route({
      text: content,
      session: {
        turnIndex: history.filter((m) => m.role === 'user').length,
        lastBand: this.lastBandByConv.get(conv.id),
        lastAssistantHadTools: false,
        recentFailure: true,
        activeMode: 'chat',
      },
    })
    this.lastBandByConv.set(conv.id, route.band)

    emit?.({ type: 'route', runId, conversationId: conv.id, decision: route })
    emit?.({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: formatRouteThinking(route),
    })

    const maxSteps = route.policy.maxSteps
    const allowLocalShortCircuit =
      maxSteps <= 0 &&
      (route.reasons.includes('greeting_only') || route.reasons.includes('self_intro'))

    if (allowLocalShortCircuit) {
      const text = localReplyForRoute(route, content)
      emit?.({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.appendAssistant(data, idx, conv, agentId, userMessage, text, 0, model.model, route)
    }

    const recursionLimit = Math.max(1, maxSteps)
    const systemPrompt = systemPromptForTier(agent.systemPrompt, route.policy.modelTier)
    const llm = createLangChainChatModel({
      id: model.id,
      baseUrl: model.baseUrl,
      apiKey: model.apiKey,
      model: model.model,
      temperature: temperatureForTier(route.policy.modelTier, model.temperature),
      maxTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
    })
    const reactAgent = createReactChatAgent({
      model: llm,
      tools: [],
      systemPrompt,
      name: agent.name,
    })

    const started = Date.now()
    try {
      const result = await invokeReactChatAgent(reactAgent, {
        message: content,
        history,
        recursionLimit,
      })
      const text = result.content.trim()
      emit?.({ type: 'thinking_done', runId, conversationId: conv.id })
      if (!text) {
        return this.appendAssistant(
          data,
          idx,
          conv,
          agentId,
          userMessage,
          friendlyReplyFailure('模型返回空内容'),
          Date.now() - started,
          model.model,
          route,
          true,
        )
      }
      return this.appendAssistant(
        data,
        idx,
        conv,
        agentId,
        userMessage,
        text,
        Date.now() - started,
        model.model,
        route,
      )
    } catch (err) {
      emit?.({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.appendAssistant(
        data,
        idx,
        conv,
        agentId,
        userMessage,
        friendlyReplyFailure(formatAgentError(err)),
        Date.now() - started,
        model.model,
        route,
        true,
      )
    }
  }

  /**
   * 确保默认路由器挂上 Structured L2。
   * 一期无独立 weak 模型表：优先名称含 flash/mini/turbo/haiku/lite 的已启用模型，否则用当前对话模型（低温短输出）。
   */
  private async routerWithL2(agentModel: ModelConfig) {
    const l2Model = await this.resolveL2Model(agentModel)
    const router = getDefaultHeuristicRouter()
    if (this.l2BoundModelId === l2Model.id) return router

    const llm = createLangChainChatModel({
      id: l2Model.id,
      baseUrl: l2Model.baseUrl,
      apiKey: l2Model.apiKey,
      model: l2Model.model,
      temperature: 0,
      maxTokens: 256,
    })
    router.setL2(createL2Classifier({ model: llm, timeoutMs: 12_000 }))
    this.l2BoundModelId = l2Model.id
    return router
  }

  private async resolveL2Model(agentModel: ModelConfig): Promise<ModelConfig> {
    const list = await this.models.list()
    const weakish = list.find(
      (m) =>
        m.enabled &&
        m.baseUrl?.trim() &&
        m.model?.trim() &&
        /flash|mini|turbo|haiku|lite|small/i.test(`${m.name} ${m.model}`),
    )
    return weakish ?? agentModel
  }

  /** 开发环境：推渲染进程 DevTools（不挂 LangChain 回调） */
  private emitLlmDebug(
    emit: ((evt: ChatStreamEvent) => void) | undefined,
    runId: string,
    conversationId: string,
    source: string,
    payload: unknown,
  ): void {
    if (!isLlmDebugLogEnabled() || !emit) return
    try {
      emit({
        type: 'llm_debug',
        runId,
        conversationId,
        source,
        payload: safeJsonStringify(payload),
      })
    } catch {
      // ignore
    }
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
    failed = false,
  ): Promise<ChatSendResult> {
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
      ...(failed ? { failed: true } : {}),
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
      ...(failed ? { failed: true } : {}),
    }
  }

  /** 用户消息已在会话中时只追加助手 */
  private async appendAssistant(
    data: Awaited<ReturnType<ChatStore['load']>>,
    idx: number,
    conv: Conversation,
    agentId: string,
    userMessage: ChatMessage,
    text: string,
    latencyMs: number,
    modelId: string,
    route: RouteDecision,
    failed = false,
  ): Promise<ChatSendResult> {
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
      ...(failed ? { failed: true } : {}),
    }
    const next: Conversation = {
      ...conv,
      agentId,
      messages: [...conv.messages, assistantMessage],
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
      ...(failed ? { failed: true } : {}),
    }
  }
}

function friendlyReplyFailure(reason: string): string {
  return `抱歉，这次没能完成回复。\n\n原因：${reason}\n\n你可以点击「重试」，或稍后再试。`
}

function formatRouteThinking(route: RouteDecision): string {
  const hints: string[] = []
  if (route.policy.hintUserCreateGroup) hints.push('可提示用户拉群')
  if (route.policy.hintUserForge) hints.push('可提示派 Forge')
  if (route.policy.allowSubAgents) hints.push('允许子 Agent')
  const l2 = route.reasons.includes('l2_classifier')
    ? '；已过 L2'
    : route.reasons.includes('l2_failed') || route.reasons.includes('l2_timeout')
      ? '；L2 失败保留 L1'
      : ''
  const hintStr = hints.length ? `；${hints.join('、')}` : ''
  return `路由 L1/L2：band=${route.band} score=${route.score} tier=${route.policy.modelTier} tools=${route.policy.tools} maxSteps=${route.policy.maxSteps}（${route.reasons.slice(0, 6).join(', ') || '—'}）${hintStr}${l2}\n`
}

function formatPolicyApply(route: RouteDecision): string {
  const p = route.policy
  const lines = [
    `应用 policy：tier=${p.modelTier}（一期仍用 Agent 绑定模型）`,
    `tools=${p.tools}${p.tools === 'full' ? '（白名单未接，暂仍无工具）' : ' → 禁用工具'}`,
    `maxSteps=${p.maxSteps}${p.maxSteps <= 0 ? ' → 将本地短路' : ` → recursionLimit=${Math.max(1, p.maxSteps)}`}`,
  ]
  if (p.modelTier === 'weak' && !(p.maxSteps <= 0 && (route.reasons.includes('greeting_only') || route.reasons.includes('self_intro')))) {
    lines.push('weak → 注入短回复约束（一两句，不列清单）')
  }
  if (p.maxSteps <= 0 && !(route.reasons.includes('greeting_only') || route.reasons.includes('self_intro'))) {
    lines.push('maxSteps=0 但非寒暄/自我介绍 → 仍调 LLM（recursionLimit≥1）')
  }
  if (p.hintUserCreateGroup) lines.push('hint：提示用户拉群（不自动建群）')
  if (p.hintUserForge) lines.push('hint：提示用户派 Forge（不自动派单）')
  if (p.allowSubAgents) lines.push('allowSubAgents=true（子 Agent 能力待接）')
  return `${lines.join('\n')}\n`
}

/** weak 档：在 Agent persona 后追加短回复约束 */
const WEAK_TIER_BRIEF = '（路由：简短档）请用一两句回复，不要列清单。'

function systemPromptForTier(
  agentPrompt: string | undefined,
  tier: RouteDecision['policy']['modelTier'],
): string | undefined {
  const base = agentPrompt?.trim() || ''
  if (tier !== 'weak') return base || undefined
  if (!base) return WEAK_TIER_BRIEF
  return `${base}\n\n${WEAK_TIER_BRIEF}`
}

/** maxSteps=0 时的本地礼貌回复；开发环境追加「· 命中L1本地短路」便于验证 */
function localReplyForRoute(route: RouteDecision, userText: string): string {
  let text: string
  if (route.reasons.includes('self_intro')) {
    text = '好的，记住了。有什么我可以帮你的吗？'
  } else if (route.reasons.includes('greeting_only') || route.band === 'trivial') {
    text = '你好！有什么我可以帮你的吗？'
  } else {
    text = `好的，已收到。需要我继续帮你处理「${truncateTitle(userText)}」相关的事吗？`
  }
  if (isLlmDebugLogEnabled()) {
    text = `${text} · 命中L1本地短路`
  }
  return text
}

/** 按档微调温度，便于验证 tier 已生效（无多模型表时的弱替代） */
function temperatureForTier(
  tier: RouteDecision['policy']['modelTier'],
  base: number,
): number {
  if (tier === 'weak') return Math.min(1, base + 0.1)
  if (tier === 'strong') return Math.max(0, base - 0.1)
  return base
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
