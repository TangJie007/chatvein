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
  forwardToActiveLlmDebugSink,
  isLlmDebugLogEnabled,
  safeJsonStringify,
  setLlmDebugSink,
} from '@chatvein/models'
import { resolveChatTools, summarizeToolsForDebug, parseMcpServersJson } from '@chatvein/tools'
import type { StructuredToolInterface } from '@chatvein/tools'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import { AgentService } from '../agent/agent.service'
import { MAIN_AGENT_ID } from '../agent/agent.types'
import type { AgentConfig } from '../agent/agent.types'
import { ModelService } from '../model/model.service'
import type { ModelConfig } from '../model/model.types'
import { SettingsService } from '../settings/settings.service'
import { ChatStore } from './chat.store'
import { makeConversationSlug } from './session-paths'
import type {
  ChatMessage,
  ChatSendInput,
  ChatSendResult,
  ChatStreamEvent,
  Conversation,
  TokenUsage,
} from './chat.types'
import {
  artifactsFromReactMessages,
  artifactsFromWorkspaceDiff,
  listWorkspaceFiles,
  mergeArtifacts,
  snapshotWorkspaceMtimes,
} from './workspace-artifacts'
import { readThinkingLog, writeThinkingLog } from './thinking-log'
import type { BaseMessage } from '@langchain/core/messages'

@Injectable()
export class ChatService {
  @Inject(ChatStore)
  private store!: ChatStore

  @Inject(AgentService)
  private agents!: AgentService

  @Inject(ModelService)
  private models!: ModelService

  @Inject(SettingsService)
  private settings!: SettingsService

  private lastBandByConv = new Map<string, ComplexityBand>()
  /** 已为该模型 id 注入过 Structured L2，避免每轮重建 */
  private l2BoundModelId: string | null = null

  async list(): Promise<Conversation[]> {
    return this.store.list()
  }

  async get(id: string): Promise<Conversation> {
    const conv = await this.store.get(id)
    if (!conv) throw new NotFoundException(`conversation:${id}`)
    return conv
  }

  async create(input?: { title?: string; agentId?: string }): Promise<Conversation> {
    const now = Date.now()
    const agentId = input?.agentId || MAIN_AGENT_ID
    await this.agents.get(agentId)

    const settings = await this.settings.get()
    const slug = makeConversationSlug(now)
    const workspacePath = join(settings.effectiveWorkspaceRoot, slug)
    const sandboxPath = join(workspacePath, 'runs')
    await fs.mkdir(workspacePath, { recursive: true })
    await fs.mkdir(sandboxPath, { recursive: true })
    await fs.mkdir(join(workspacePath, 'scripts'), { recursive: true })
    await fs.mkdir(join(workspacePath, 'logs'), { recursive: true })

    const conv: Conversation = {
      id: randomUUID(),
      title: input?.title?.trim() || '新对话',
      agentId,
      workspacePath,
      sandboxPath,
      slug,
      messages: [],
      createdAt: now,
      updatedAt: now,
    }
    return this.store.insert(conv)
  }

  async remove(id: string): Promise<{ ok: true }> {
    const removed = await this.store.remove(id)
    if (!removed) throw new NotFoundException(`conversation:${id}`)
    this.lastBandByConv.delete(id)
    // 会话根目录包含 runs/ 与 scripts/；聊天历史在 SQLite，删库行即可
    await fs.rm(removed.workspacePath, { recursive: true, force: true }).catch(() => undefined)
    return { ok: true }
  }

  /** 列出会话工作区现有文件（产物面板回填；不含空目录） */
  async listArtifacts(conversationId: string) {
    const conv = await this.store.get(conversationId)
    if (!conv) throw new NotFoundException(`conversation:${conversationId}`)
    const files = await listWorkspaceFiles(conv.workspacePath)
    return artifactsFromWorkspaceDiff(new Map(), files)
  }

  /** 读取某条助手回复对应的思考流日志 */
  async getThinkingLog(conversationId: string, messageId: string): Promise<{ text: string | null }> {
    const conv = await this.store.get(conversationId)
    if (!conv) throw new NotFoundException(`conversation:${conversationId}`)
    try {
      const text = await readThinkingLog(conv.workspacePath, messageId)
      return { text }
    } catch {
      return { text: null }
    }
  }

  /**
   * 普通对话：L1/L1.5 →（灰区）L2 结构化分类 → Agent ReAct。
   * `policy.tools=full` 时经 `@chatvein/tools` 绑定目录工具（∩ 角色白名单）。
   */
  async send(
    input: ChatSendInput,
    emitOuter?: (evt: ChatStreamEvent) => void,
  ): Promise<ChatSendResult> {
    const thinkingParts: string[] = []
    const emit = (evt: ChatStreamEvent) => {
      if (evt.type === 'thinking_delta') thinkingParts.push(evt.delta)
      emitOuter?.(evt)
    }
    const content = (input.content || '').trim()
    if (!content) throw new ValidationException('消息不能为空', [])

    const conv = await this.store.get(input.conversationId)
    if (!conv) throw new NotFoundException(`conversation:${input.conversationId}`)

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
    emit({
      type: 'run_start',
      runId,
      conversationId: conv.id,
      agent: agent.name,
      ts: Date.now(),
    })

    const clearLlmDebug = this.beginRequestLlmDebug(emit, runId, conv.id)
    try {
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

    emit({
      type: 'route',
      runId,
      conversationId: conv.id,
      decision: route,
    })
    emit({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: formatRouteThinking(route),
    })

    if (route.terminal?.kind === 'slash') {
      const cmd = String(route.terminal.payload?.slashCmd ?? '')
      const text = `已识别命令 /${cmd}（本地处理占位；尚未绑定具体动作）。`
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.persistAssistant(conv, agentId, userMessage, text, 0, model.model, route, false, undefined, thinkingParts.join(''))
    }

    if (route.terminal?.kind === 'empty') {
      const text = '（空消息，已忽略）'
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.persistAssistant(conv, agentId, userMessage, text, 0, model.model, route, false, undefined, thinkingParts.join(''))
    }

    // —— 吃满 L1 policy（开发验证）——
    const maxSteps = route.policy.maxSteps
    const toolPolicy = route.policy.tools

    emit({
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
      emit({
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
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.persistAssistant(conv, agentId, userMessage, text, 0, model.model, route, false, undefined, thinkingParts.join(''))
    }

    const recursionLimit = Math.max(1, maxSteps)
    // 路由约束写入 system：L2/策略 trivial → 友好短答；weak → 简短不列清单
    const systemPrompt = systemPromptForRoute(agent.systemPrompt, route)
    const llm = this.createDebugAwareLlm(model, {
      temperature: temperatureForTier(route.policy.modelTier, model.temperature),
      maxTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
    })

    const boundTools = await this.resolveBoundTools(agent, toolPolicy, conv.workspacePath)
    if (boundTools.length > 0) {
      emit({
        type: 'thinking_delta',
        runId,
        conversationId: conv.id,
        delta: `绑定工具：${boundTools.map((t) => t.name).join(', ')}\n`,
      })
    }
    const reactAgent = createReactChatAgent({
      model: llm,
      tools: boundTools,
      systemPrompt,
      name: agent.name,
    })

    const started = Date.now()
    const beforeSnap = await snapshotWorkspaceMtimes(conv.workspacePath)
    let text: string
    let usage: TokenUsage | undefined
    let reactMessages: BaseMessage[] = []
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
        toolsBound: boundTools.map((t) => t.name),
        /** 与真实 bind 对齐的工具描述 + JSON Schema（便于对照网关 tools 字段） */
        tools: summarizeToolsForDebug(boundTools),
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
      usage = result.usage
      reactMessages = result.messages

      this.emitLlmDebug(emit, runId, conv.id, 'react:response', {
        content: result.content,
        messageCount: result.messages.length,
        messages: result.messages,
        usage: result.usage,
        latencyMs: Date.now() - started,
      })
    } catch (err) {
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.persistAssistant(
        conv,
        agentId,
        userMessage,
        friendlyReplyFailure(formatAgentError(err)),
        Date.now() - started,
        model.model,
        route,
        true,
        undefined,
        thinkingParts.join(''),
      )
    }
    const latencyMs = Date.now() - started
    await this.emitRunArtifacts(emit, runId, conv, beforeSnap, reactMessages)
    emit({ type: 'thinking_done', runId, conversationId: conv.id })

    if (!text) {
      return this.persistAssistant(
        conv,
        agentId,
        userMessage,
        friendlyReplyFailure('模型返回空内容'),
        latencyMs,
        model.model,
        route,
        true,
        undefined,
        thinkingParts.join(''),
      )
    }

    return this.persistAssistant(
      conv,
      agentId,
      userMessage,
      text,
      latencyMs,
      model.model,
      route,
      false,
      usage,
      thinkingParts.join(''),
    )
    } finally {
      clearLlmDebug?.()
    }
  }

  /**
   * 重试失败的助手回复：保留原用户消息，去掉失败气泡后重新生成。
   */
  async retry(
    input: { conversationId: string; failedMessageId: string },
    emit?: (evt: ChatStreamEvent) => void,
  ): Promise<ChatSendResult> {
    let conv = await this.store.get(input.conversationId)
    if (!conv) throw new NotFoundException(`conversation:${input.conversationId}`)

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

    conv = {
      ...conv,
      messages: conv.messages.slice(0, failIdx),
      updatedAt: Date.now(),
    }
    await this.store.updateMeta(conv.id, { updatedAt: conv.updatedAt })
    await this.store.replaceMessages(conv.id, conv.messages)

    return this.regenerateAfterUser(conv, userMessage, emit)
  }

  /** 会话末尾已是 userMessage 时，只生成助手回复并追加 */
  private async regenerateAfterUser(
    conv: Conversation,
    userMessage: ChatMessage,
    emitOuter?: (evt: ChatStreamEvent) => void,
  ): Promise<ChatSendResult> {
    const thinkingParts: string[] = []
    const emit = (evt: ChatStreamEvent) => {
      if (evt.type === 'thinking_delta') thinkingParts.push(evt.delta)
      emitOuter?.(evt)
    }
    const thinkingLog = () => thinkingParts.join('')

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
    emit({
      type: 'run_start',
      runId,
      conversationId: conv.id,
      agent: agent.name,
      ts: Date.now(),
    })

    const clearLlmDebug = this.beginRequestLlmDebug(emit, runId, conv.id)
    try {
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

    emit({ type: 'route', runId, conversationId: conv.id, decision: route })
    emit({
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
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.appendAssistant(conv, agentId, userMessage, text, 0, model.model, route, false, undefined, thinkingLog())
    }

    const recursionLimit = Math.max(1, maxSteps)
    const systemPrompt = systemPromptForRoute(agent.systemPrompt, route)
    const llm = this.createDebugAwareLlm(model, {
      temperature: temperatureForTier(route.policy.modelTier, model.temperature),
      maxTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
    })
    const boundTools = await this.resolveBoundTools(agent, route.policy.tools, conv.workspacePath)
    const reactAgent = createReactChatAgent({
      model: llm,
      tools: boundTools,
      systemPrompt,
      name: agent.name,
    })

    const started = Date.now()
    const beforeSnap = await snapshotWorkspaceMtimes(conv.workspacePath)
    try {
      const result = await invokeReactChatAgent(reactAgent, {
        message: content,
        history,
        recursionLimit,
      })
      const text = result.content.trim()
      await this.emitRunArtifacts(emit, runId, conv, beforeSnap, result.messages)
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      if (!text) {
        return this.appendAssistant(
          conv,
          agentId,
          userMessage,
          friendlyReplyFailure('模型返回空内容'),
          Date.now() - started,
          model.model,
          route,
          true,
          undefined,
          thinkingLog(),
        )
      }
      return this.appendAssistant(
        conv,
        agentId,
        userMessage,
        text,
        Date.now() - started,
        model.model,
        route,
        false,
        result.usage,
        thinkingLog(),
      )
    } catch (err) {
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return this.appendAssistant(
        conv,
        agentId,
        userMessage,
        friendlyReplyFailure(formatAgentError(err)),
        Date.now() - started,
        model.model,
        route,
        true,
        undefined,
        thinkingLog(),
      )
    }
    } finally {
      clearLlmDebug?.()
    }
  }

  /**
   * 本轮结束后：工作区磁盘 diff ∪ 写文件类 tool_calls → `artifacts` 事件。
   */
  private async emitRunArtifacts(
    emit: ((evt: ChatStreamEvent) => void) | undefined,
    runId: string,
    conv: Conversation,
    beforeSnap: Map<string, number>,
    messages: BaseMessage[],
  ): Promise<void> {
    if (!emit) return
    try {
      const after = await listWorkspaceFiles(conv.workspacePath)
      const items = mergeArtifacts(
        artifactsFromWorkspaceDiff(beforeSnap, after),
        artifactsFromReactMessages(messages, conv.workspacePath),
      )
      if (items.length === 0) return
      emit({ type: 'artifacts', runId, conversationId: conv.id, items })
    } catch (err) {
      console.warn('[ChatService] emitRunArtifacts failed', err)
    }
  }

  /**
   * policy.tools ∩ 角色白名单 → LangChain 工具实例。
   * `agent.tools` 为空 = 尚未配置白名单，视为允许目录默认集。
   */
  private async resolveBoundTools(
    agent: AgentConfig,
    toolPolicy: RouteDecision['policy']['tools'],
    workspaceRoot?: string,
  ): Promise<StructuredToolInterface[]> {
    const settings = await this.settings.get()
    return resolveChatTools({
      policy: toolPolicy,
      allowIds: agent.tools.length > 0 ? agent.tools : 'all',
      workspaceRoot: workspaceRoot?.trim() || settings.effectiveWorkspaceRoot,
      secrets: {
        serpApiKey: process.env.SERPAPI_API_KEY,
        braveApiKey: process.env.BRAVE_SEARCH_API_KEY,
        tavilyApiKey: process.env.TAVILY_API_KEY,
        wolframAppId: process.env.WOLFRAM_ALPHA_APPID,
      },
      mcpServers: parseMcpServersJson(process.env.CHATVEIN_MCP_SERVERS),
    })
  }

  /**
   * 确保默认路由器挂上 Structured L2。
   * 一期无独立 weak 模型表：优先名称含 flash/mini/turbo/haiku/lite 的已启用模型，否则用当前对话模型（低温短输出）。
   */
  private async routerWithL2(agentModel: ModelConfig) {
    const l2Model = await this.resolveL2Model(agentModel)
    const router = getDefaultHeuristicRouter()
    if (this.l2BoundModelId === l2Model.id) return router

    const llm = this.createDebugAwareLlm(l2Model, {
      temperature: 0,
      maxTokens: 256,
    })
    router.setL2(createL2Classifier({ model: llm, timeoutMs: 12_000 }))
    this.l2BoundModelId = l2Model.id
    return router
  }

  /**
   * 本轮请求期内挂上 LLM debug sink；L2 / ReAct 共用。
   * 返回清理函数（finally 调用）。
   */
  private beginRequestLlmDebug(
    emit: ((evt: ChatStreamEvent) => void) | undefined,
    runId: string,
    conversationId: string,
  ): (() => void) | undefined {
    if (!isLlmDebugLogEnabled() || !emit) return undefined
    return setLlmDebugSink((source, payload) => {
      this.emitLlmDebug(emit, runId, conversationId, source, payload)
    })
  }

  /**
   * 始终挂 forwardToActiveLlmDebugSink：无 activeSink 时为空操作。
   * L2 模型会缓存，避免「首次未开 debug → 之后开了仍无逐步日志」。
   */
  private createDebugAwareLlm(
    model: ModelConfig,
    opts: { temperature?: number; maxTokens?: number },
  ) {
    return createLangChainChatModel(
      {
        id: model.id,
        baseUrl: model.baseUrl,
        apiKey: model.apiKey,
        model: model.model,
        temperature: opts.temperature ?? model.temperature,
        maxTokens: opts.maxTokens,
      },
      { onLlmDebug: forwardToActiveLlmDebugSink },
    )
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

  /** 开发环境：经 IPC 推渲染进程 DevTools（`[chatvein:llm:…]`） */
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
    conv: Conversation,
    agentId: string,
    userMessage: ChatMessage,
    text: string,
    latencyMs: number,
    modelId: string,
    route: RouteDecision,
    failed = false,
    usage?: TokenUsage,
    thinkingLog = '',
  ): Promise<ChatSendResult> {
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
      latencyMs,
      ...(usage && usage.totalTokens > 0 ? { usage } : {}),
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
    await this.store.updateMeta(next.id, {
      title: next.title,
      agentId: next.agentId,
      updatedAt: next.updatedAt,
    })
    await this.store.replaceMessages(next.id, next.messages)
    await writeThinkingLog(conv.workspacePath, assistantMessage.id, thinkingLog).catch((err) => {
      console.warn('[ChatService] writeThinkingLog failed', err)
    })

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
    conv: Conversation,
    agentId: string,
    userMessage: ChatMessage,
    text: string,
    latencyMs: number,
    modelId: string,
    route: RouteDecision,
    failed = false,
    usage?: TokenUsage,
    thinkingLog = '',
  ): Promise<ChatSendResult> {
    const assistantMessage: ChatMessage = {
      id: randomUUID(),
      role: 'assistant',
      content: text,
      createdAt: Date.now(),
      latencyMs,
      ...(usage && usage.totalTokens > 0 ? { usage } : {}),
      ...(failed ? { failed: true } : {}),
    }
    const next: Conversation = {
      ...conv,
      agentId,
      messages: [...conv.messages, assistantMessage],
      updatedAt: Date.now(),
    }
    await this.store.updateMeta(next.id, {
      agentId: next.agentId,
      updatedAt: next.updatedAt,
    })
    await this.store.replaceMessages(next.id, next.messages)
    await writeThinkingLog(conv.workspacePath, assistantMessage.id, thinkingLog).catch((err) => {
      console.warn('[ChatService] writeThinkingLog failed', err)
    })
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
    `tools=${p.tools}${p.tools === 'full' ? ' → 绑定 @chatvein/tools 目录' : ' → 禁用工具'}`,
    `maxSteps=${p.maxSteps}${p.maxSteps <= 0 ? ' → 将本地短路' : ` → recursionLimit=${Math.max(1, p.maxSteps)}`}`,
  ]
  if (route.band === 'trivial') {
    lines.push('trivial → 主模型友好短答（非 L1 本地模板）')
  } else if (p.modelTier === 'weak' && !(p.maxSteps <= 0 && (route.reasons.includes('greeting_only') || route.reasons.includes('self_intro')))) {
    lines.push('weak → 注入短回复约束（一两句，不列清单）')
  }
  if (p.maxSteps <= 0 && !(route.reasons.includes('greeting_only') || route.reasons.includes('self_intro'))) {
    lines.push('maxSteps=0 但非 L1 寒暄/自我介绍 → 仍调 LLM（recursionLimit≥1）')
  }
  if (p.hintUserCreateGroup) lines.push('hint：提示用户拉群（不自动建群）')
  if (p.hintUserForge) lines.push('hint：提示用户派 Forge（不自动派单）')
  if (p.allowSubAgents) lines.push('allowSubAgents=true（子 Agent 能力待接）')
  return `${lines.join('\n')}\n`
}

/**
 * 按路由给主模型追加回答约束（仅 LLM 路径；L1 本地短路不会走到这里）。
 * - band=trivial（含 L2 拍板）：友好简短寒暄式回复
 * - modelTier=weak：一两句、不列清单
 */
const TRIVIAL_BAND_BRIEF =
  '（路由：闲聊/寒暄档）请友好、简短地回复一两句，像正常打招呼或确认；不要列能力清单，不要长篇展开。'
const WEAK_TIER_BRIEF = '（路由：简短档）请用一两句回复，不要列清单。'

function systemPromptForRoute(
  agentPrompt: string | undefined,
  route: RouteDecision,
): string | undefined {
  const base = agentPrompt?.trim() || ''
  const extras: string[] = []
  if (route.band === 'trivial') {
    extras.push(TRIVIAL_BAND_BRIEF)
  } else if (route.policy.modelTier === 'weak') {
    extras.push(WEAK_TIER_BRIEF)
  }
  if (extras.length === 0) return base || undefined
  if (!base) return extras.join('\n')
  return `${base}\n\n${extras.join('\n')}`
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
