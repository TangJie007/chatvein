import { Injectable, Inject, NotFoundException, ValidationException } from '@electrum/common'
import {
  createL2Classifier,
  createReactChatAgent,
  getDefaultHeuristicRouter,
  invokeReactChatAgent,
  WorkspaceCheckpointer,
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
import {
  buildSummarizePrompt,
  consolidateShortTerm,
  planShortTerm,
  type ShortTermMessage,
  type ShortTermPlan,
  type ShortTermState,
} from '@chatvein/memory'
import { createEndpointModel } from '@chatvein/models'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
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
import { readShortTermState, resetShortTermState, writeShortTermState } from './short-term.store'
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
  /** 每会话串行化短期记忆压缩，避免并发写同一份状态 */
  private shortTermQueue = new Map<string, Promise<void>>()
  /** 按工作区缓存 LangGraph checkpointer（跨进程持久化 agent 工作记忆） */
  private checkpointers = new Map<string, WorkspaceCheckpointer>()

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
    await fs.mkdir(join(workspacePath, 'memory'), { recursive: true })

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
    this.shortTermQueue.delete(id)
    const cp = this.checkpointers.get(removed.workspacePath)
    if (cp) {
      cp.close()
      this.checkpointers.delete(removed.workspacePath)
    }
    // 会话根目录包含 runs/ 与 scripts/；聊天历史在 SQLite，删库行即可
    await resetShortTermState(removed.workspacePath).catch(() => undefined)
    await fs.rm(removed.workspacePath, { recursive: true, force: true }).catch(() => undefined)
    return { ok: true }
  }

  /**
   * 取（或创建）某工作区的 LangGraph checkpointer：把 agent 每轮消息轨迹落盘到
   * `{workspacePath}/memory/checkpoints.db`，跨进程持久化、支持 thread resume。
   */
  private getCheckpointer(workspacePath: string): WorkspaceCheckpointer {
    let cp = this.checkpointers.get(workspacePath)
    if (!cp) {
      const dbPath = join(workspacePath, 'memory', 'checkpoints.db')
      cp = new WorkspaceCheckpointer({ dbPath })
      this.checkpointers.set(workspacePath, cp)
    }
    return cp
  }

  /** 列出会话工作区现有文件（产物面板回填；不含空目录） */
  async listArtifacts(conversationId: string) {
    const conv = await this.store.get(conversationId)
    if (!conv) throw new NotFoundException(`conversation:${conversationId}`)
    const files = await listWorkspaceFiles(conv.workspacePath)
    return artifactsFromWorkspaceDiff(new Map(), files)
  }

  /**
   * 删除产物文件：必须落在该会话 workspace 内，且不得删 memory/ 等内部目录。
   */
  async removeArtifact(
    conversationId: string,
    absPath: string,
  ): Promise<{ ok: true; absPath: string }> {
    const conv = await this.store.get(conversationId)
    if (!conv) throw new NotFoundException(`conversation:${conversationId}`)

    const targetRaw = absPath?.trim()
    if (!targetRaw) throw new ValidationException('产物路径不能为空')

    const root = resolve(conv.workspacePath)
    const target = resolve(isAbsolute(targetRaw) ? targetRaw : join(root, targetRaw))
    const relToRoot = relative(root, target)
    if (
      !relToRoot ||
      isAbsolute(relToRoot) ||
      relToRoot === '..' ||
      relToRoot.startsWith(`..${sep}`) ||
      relToRoot.startsWith('../') ||
      relToRoot.startsWith('..\\')
    ) {
      throw new ValidationException('只能删除当前会话工作区内的文件')
    }

    const relPosix = relToRoot.split(/[/\\]/).join('/')
    if (relPosix === 'memory' || relPosix.startsWith('memory/')) {
      throw new ValidationException('不能删除 memory 内部文件')
    }
    const top = relPosix.split('/')[0] ?? ''
    if (['node_modules', '.git', '.venv', '__pycache__', '.cache', 'logs'].includes(top)) {
      throw new ValidationException(`不能删除受保护目录：${top}`)
    }

    let st
    try {
      st = await fs.lstat(target)
    } catch {
      throw new NotFoundException(target)
    }
    if (st.isDirectory()) {
      throw new ValidationException('产物面板仅支持删除文件，不支持删除目录')
    }
    if (st.isSymbolicLink()) {
      throw new ValidationException('不能删除符号链接')
    }

    await fs.unlink(target)
    return { ok: true, absPath: target }
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

    const shortTermState = await readShortTermState(conv.workspacePath)
    const shortTerm = await this.buildShortTermHistory(conv, shortTermState)
    const history = shortTerm.history

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
    emit({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: formatShortTermThinking(shortTerm.plan),
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
    const checkpointer = this.getCheckpointer(conv.workspacePath)
    await checkpointer.deleteThread(conv.id)
    const reactAgent = createReactChatAgent({
      model: llm,
      tools: boundTools,
      systemPrompt,
      name: agent.name,
      checkpointer,
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
        /** 短期记忆裁剪结果：摘要覆盖 / 窗口 / 待摘要 / 估算 token */
        shortTerm: shortTermDebugInfo(shortTerm.plan),
      })

      const result = await invokeReactChatAgent(reactAgent, {
        message: content,
        history,
        recursionLimit,
        threadId: conv.id,
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

    const result = await this.persistAssistant(
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
    // 短期记忆：本轮一问一答已落库，异步把挤出窗口的旧消息并入滚动摘要
    this.scheduleShortTermConsolidation(result.conversation, emit, runId)
    return result
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
    const shortTermState = await readShortTermState(conv.workspacePath)
    // 会话末尾那条就是本轮输入（retry 场景），不算历史
    const shortTerm = await this.buildShortTermHistory(conv, shortTermState, { dropLast: true })
    const history = shortTerm.history

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
    emit({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: formatShortTermThinking(shortTerm.plan),
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
    const checkpointer = this.getCheckpointer(conv.workspacePath)
    await checkpointer.deleteThread(conv.id)
    const reactAgent = createReactChatAgent({
      model: llm,
      tools: boundTools,
      systemPrompt,
      name: agent.name,
      checkpointer,
    })

    const started = Date.now()
    const beforeSnap = await snapshotWorkspaceMtimes(conv.workspacePath)
    try {
      const result = await invokeReactChatAgent(reactAgent, {
        message: content,
        history,
        recursionLimit,
        threadId: conv.id,
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
      const ok = await this.appendAssistant(
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
      this.scheduleShortTermConsolidation(ok.conversation, emit, runId)
      return ok
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
   * 短期记忆读路径：会话全量历史 → `摘要块（system） + 近因窗口`。
   * `dropLast` 用于 retry：会话末尾那条用户消息是本轮输入，不算历史。
   */
  private async buildShortTermHistory(
    conv: Conversation,
    state: ShortTermState | null,
    opts?: { dropLast?: boolean },
  ): {
    history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
    plan: ShortTermPlan
  } {
    const source = opts?.dropLast ? conv.messages.slice(0, -1) : conv.messages
    const messages = toShortTermMessages(source)
    const plan = await planShortTerm({ messages, state, reserveTokens: SHORT_TERM_RESERVE_TOKENS })
    const history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }> = []
    if (plan.summaryBlock) history.push(plan.summaryBlock)
    for (const m of plan.active) history.push({ role: m.role, content: m.content })
    return { history, plan }
  }

  /** 本轮结束后异步压缩短期记忆（不阻塞回复返回，按会话串行） */
  private scheduleShortTermConsolidation(
    conv: Conversation,
    emit: ((evt: ChatStreamEvent) => void) | undefined,
    runId: string,
  ): void {
    const prev = this.shortTermQueue.get(conv.id) ?? Promise.resolve()
    const next = prev
      .catch(() => undefined)
      .then(() => this.runShortTermConsolidation(conv, emit, runId))
      .catch((err) => {
        console.warn('[ChatService] short-term consolidation failed', err)
      })
    this.shortTermQueue.set(conv.id, next)
    void next.finally(() => {
      if (this.shortTermQueue.get(conv.id) === next) this.shortTermQueue.delete(conv.id)
    })
  }

  private async runShortTermConsolidation(
    conv: Conversation,
    emit: ((evt: ChatStreamEvent) => void) | undefined,
    runId: string,
  ): Promise<void> {
    const state = await readShortTermState(conv.workspacePath)
    const messages = toShortTermMessages(conv.messages)

    // 先探一次：没有待摘要消息就不必解析模型配置
    if ((await planShortTerm({ messages, state })).pending.length === 0) return

    const agent = await this.agents.get(conv.agentId || MAIN_AGENT_ID)
    if (!agent?.modelId) return
    const model = await this.models.get(agent.modelId)
    if (!model?.enabled || !model.baseUrl?.trim() || !model.model?.trim()) return

    const summarizer = await this.shortTermSummarizer(model)
    const result = await consolidateShortTerm({ messages, state, summarizer })
    if (result.consolidated === 0) return

    await writeShortTermState(conv.workspacePath, result.state)
    this.emitLlmDebug(emit, runId, conv.id, 'memory:short-term', {
      consolidated: result.consolidated,
      viaModel: result.viaModel,
      summarizedCount: result.state.summarizedCount,
      summaryChars: result.state.summary.length,
      summary: result.state.summary,
    })
  }

  /** 摘要器：weak 档模型 + 短输出；调用失败由 consolidate 内部降级 */
  private async shortTermSummarizer(agentModel: ModelConfig) {
    const weak = await this.resolveL2Model(agentModel)
    const endpoint = createEndpointModel({
      id: weak.id,
      baseUrl: weak.baseUrl,
      apiKey: weak.apiKey,
      model: weak.model,
      temperature: 0,
      maxTokens: 512,
    })
    return async (
      input: Parameters<typeof buildSummarizePrompt>[0],
    ): Promise<string> => {
      const [system, user] = buildSummarizePrompt(input)
      const res = await endpoint.invoke(
        [
          { role: 'system', content: system.content },
          { role: 'user', content: user.content },
        ],
        { timeoutMs: 20_000 },
      )
      return res.content
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

/** 短期记忆：给本轮用户消息预留的 token（不占用窗口预算） */
const SHORT_TERM_RESERVE_TOKENS = 800

/** ChatMessage[] → ShortTermMessage[]（id 作摘要游标） */
function toShortTermMessages(messages: Conversation['messages']): ShortTermMessage[] {
  return messages.map((m) => ({
    id: m.id,
    role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user',
    content: m.content,
    ...(m.failed ? { failed: true } : {}),
  }))
}

/** 短期记忆裁剪结果 → 思考面板一行 */
function formatShortTermThinking(plan: ShortTermPlan): string {
  const s = plan.stats
  const parts = [
    `窗口 ${s.activeCount} 条`,
    `摘要覆盖 ${s.summarizedCount} 条`,
    `待摘要 ${s.pendingCount} 条`,
    `约 ${s.estimatedTokens} tokens`,
  ]
  if (s.truncatedCount > 0) parts.push(`折叠 ${s.truncatedCount} 条`)
  if (!s.cursorValid) parts.push('游标失效→重算')
  return `短期记忆：${parts.join(' / ')}\n`
}

/** 短期记忆 → llm_debug 字段 */
function shortTermDebugInfo(plan: ShortTermPlan) {
  return {
    activeCount: plan.stats.activeCount,
    summarizedCount: plan.stats.summarizedCount,
    pendingCount: plan.stats.pendingCount,
    estimatedTokens: plan.stats.estimatedTokens,
    truncatedCount: plan.stats.truncatedCount,
    cursorValid: plan.stats.cursorValid,
    summaryChars: plan.summaryBlock?.content.length ?? 0,
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
