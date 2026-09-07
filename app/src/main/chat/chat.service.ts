import {
  Injectable,
  Inject,
  NotFoundException,
  ValidationException,
  type OnAppReady,
} from '@electrum/common'
import { WorkspaceCheckpointer } from '@chatvein/agents'
import type { ComplexityBand, RouteDecision } from '@chatvein/common'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { isAbsolute, join, relative, resolve, sep } from 'node:path'
import { AgentService } from '../agent/agent.service'
import { MAIN_AGENT_ID } from '../agent/agent.types'
import { ModelService } from '../model/model.service'
import { SettingsService } from '../settings/settings.service'
import { CODER_AGENT_ID } from './constants'
import { ChatStore } from './session/chat.store'
import { makeConversationSlug } from './session/session-paths'
import type {
  ChatMessage,
  ChatSendInput,
  ChatSendResult,
  ChatStreamEvent,
  Conversation,
  TokenUsage,
} from './chat.types'
import {
  artifactsFromWorkspaceDiff,
  listWorkspaceFiles,
} from './artifacts/workspace-artifacts'
import { readThinkingLog, writeThinkingLog } from './artifacts/thinking-log'
import { readShortTermState, resetShortTermState } from './memory/short-term.store'
import { ShortTermMemory } from './memory/short-term'
import { ToolIndexService } from './tools/tool-index.service'
import { runForgeCodingTurn } from './forge/forge-turn'
import { ChatLlmHelper } from './turn/llm'
import { runOfficeReactTurn, truncateTitle } from './turn/office-turn'

@Injectable()
export class ChatService implements OnAppReady {
  @Inject(ChatStore)
  private store!: ChatStore

  @Inject(AgentService)
  private agents!: AgentService

  @Inject(ModelService)
  private models!: ModelService

  @Inject(SettingsService)
  private settings!: SettingsService

  @Inject(ToolIndexService)
  private toolIndex!: ToolIndexService

  @Inject(ShortTermMemory)
  private shortTerm!: ShortTermMemory

  @Inject(ChatLlmHelper)
  private llm!: ChatLlmHelper

  private lastBandByConv = new Map<string, ComplexityBand>()
  /** 按工作区缓存 LangGraph checkpointer（跨进程持久化 agent 工作记忆） */
  private checkpointers = new Map<string, WorkspaceCheckpointer>()
  /** 会话当前运行的 AbortController（停止生成） */
  private abortByConv = new Map<string, AbortController>()

  /** 取消指定会话正在进行的 send/retry */
  abort(conversationId: string): { ok: true; aborted: boolean } {
    const ac = this.abortByConv.get(conversationId)
    if (!ac) return { ok: true, aborted: false }
    ac.abort()
    this.abortByConv.delete(conversationId)
    return { ok: true, aborted: true }
  }

  private beginAbort(conversationId: string): AbortSignal {
    this.abortByConv.get(conversationId)?.abort()
    const ac = new AbortController()
    this.abortByConv.set(conversationId, ac)
    return ac.signal
  }

  private endAbort(conversationId: string, signal: AbortSignal): void {
    const cur = this.abortByConv.get(conversationId)
    if (cur?.signal === signal) this.abortByConv.delete(conversationId)
  }
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
    this.shortTerm.dropQueue(id)
    const cp = this.checkpointers.get(removed.workspacePath)
    if (cp) {
      cp.close()
      this.checkpointers.delete(removed.workspacePath)
    }
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
    if (!targetRaw) throw new ValidationException('产物路径不能为空', [])

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
      throw new ValidationException('只能删除当前会话工作区内的文件', [])
    }

    const relPosix = relToRoot.split(/[/\\]/).join('/')
    if (relPosix === 'memory' || relPosix.startsWith('memory/')) {
      throw new ValidationException('不能删除 memory 内部文件', [])
    }
    const top = relPosix.split('/')[0] ?? ''
    if (['node_modules', '.git', '.venv', '__pycache__', '.cache', 'logs'].includes(top)) {
      throw new ValidationException(`不能删除受保护目录：${top}`, [])
    }

    let st
    try {
      st = await fs.lstat(target)
    } catch {
      throw new NotFoundException(target)
    }
    if (st.isDirectory()) {
      throw new ValidationException('产物面板仅支持删除文件，不支持删除目录', [])
    }
    if (st.isSymbolicLink()) {
      throw new ValidationException('不能删除符号链接', [])
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

    const workMode = input.workMode ?? 'office'
    const { agentId, agent, model } = await this.resolveAgentModel(
      input.agentId || conv.agentId || MAIN_AGENT_ID,
      workMode,
    )

    const now = Date.now()
    const userMessage: ChatMessage = {
      id: randomUUID(),
      role: 'user',
      content,
      createdAt: now,
    }

    const shortTermState = await readShortTermState(conv.workspacePath)
    const shortTerm = await this.shortTerm.buildHistory(conv, shortTermState)

    const runId = randomUUID()
    emit({
      type: 'run_start',
      runId,
      conversationId: conv.id,
      agent: agent.name,
      ts: Date.now(),
    })

    const clearTelemetry = this.llm.beginRequestTelemetry(emit, runId, conv.id)
    const signal = this.beginAbort(conv.id)
    try {
      if (workMode === 'code') {
        const forgeStarted = Date.now()
        const weakModel = await this.llm.resolveL2Model(model)
        return await runForgeCodingTurn(
          { settings: this.settings, weakModel },
          {
            conv,
            agentId,
            agent,
            model,
            userMessage,
            content,
            runId,
            emit,
            thinkingParts,
            signal,
            resumeForge: input.resumeForge,
            persist: (text, failed) =>
              this.persistAssistant(
                conv,
                agentId,
                userMessage,
                text,
                Date.now() - forgeStarted,
                model.model,
                undefined,
                failed,
                undefined,
                thinkingParts.join(''),
              ),
          },
        )
      }

      return await runOfficeReactTurn(
        {
          llm: this.llm,
          toolIndex: this.toolIndex,
          getCheckpointer: (ws) => this.getCheckpointer(ws),
        },
        {
          conv,
          agent,
          model,
          content,
          history: shortTerm.history,
          shortTermPlan: shortTerm.plan,
          runId,
          emit,
          mode: 'send',
          lastBand: this.lastBandByConv.get(conv.id),
          setLastBand: (band) => this.lastBandByConv.set(conv.id, band),
          signal,
          persist: ({ text, failed, route, latencyMs, usage }) =>
            this.persistAssistant(
              conv,
              agentId,
              userMessage,
              text,
              latencyMs,
              model.model,
              route,
              failed,
              usage,
              thinkingParts.join(''),
            ),
          scheduleShortTerm: (result) =>
            this.shortTerm.scheduleConsolidation(result.conversation, emit, runId),
        },
      )
    } finally {
      this.endAbort(conv.id, signal)
      clearTelemetry?.()
    }
  }

  /**
   * 重试失败的助手回复：保留原用户消息，去掉失败气泡后重新生成。
   */
  async retry(
    input: {
      conversationId: string
      failedMessageId: string
      workMode?: 'office' | 'code' | 'custom'
      resumeForge?: boolean
    },
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

    return this.regenerateAfterUser(
      conv,
      userMessage,
      emit,
      input.workMode ?? 'office',
      input.resumeForge,
    )
  }

  /** 会话末尾已是 userMessage 时，只生成助手回复并追加 */
  private async regenerateAfterUser(
    conv: Conversation,
    userMessage: ChatMessage,
    emitOuter?: (evt: ChatStreamEvent) => void,
    workMode: 'office' | 'code' | 'custom' = 'office',
    resumeForge?: boolean,
  ): Promise<ChatSendResult> {
    const thinkingParts: string[] = []
    const emit = (evt: ChatStreamEvent) => {
      if (evt.type === 'thinking_delta') thinkingParts.push(evt.delta)
      emitOuter?.(evt)
    }

    const { agentId, agent, model } = await this.resolveAgentModel(
      conv.agentId || MAIN_AGENT_ID,
      workMode,
    )
    const content = userMessage.content
    const shortTermState = await readShortTermState(conv.workspacePath)
    const shortTerm = await this.shortTerm.buildHistory(conv, shortTermState, { dropLast: true })

    const runId = randomUUID()
    emit({
      type: 'run_start',
      runId,
      conversationId: conv.id,
      agent: agent.name,
      ts: Date.now(),
    })

    const clearTelemetry = this.llm.beginRequestTelemetry(emit, runId, conv.id)
    const signal = this.beginAbort(conv.id)
    try {
      if (workMode === 'code') {
        const forgeStarted = Date.now()
        const weakModel = await this.llm.resolveL2Model(model)
        return await runForgeCodingTurn(
          { settings: this.settings, weakModel },
          {
            conv,
            agentId,
            agent,
            model,
            userMessage,
            content,
            runId,
            emit,
            thinkingParts,
            signal,
            resumeForge,
            persist: (text, failed) =>
              this.appendAssistant(
                conv,
                agentId,
                userMessage,
                text,
                Date.now() - forgeStarted,
                model.model,
                undefined,
                failed,
                undefined,
                thinkingParts.join(''),
              ),
          },
        )
      }

      return await runOfficeReactTurn(
        {
          llm: this.llm,
          toolIndex: this.toolIndex,
          getCheckpointer: (ws) => this.getCheckpointer(ws),
        },
        {
          conv,
          agent,
          model,
          content,
          history: shortTerm.history,
          shortTermPlan: shortTerm.plan,
          runId,
          emit,
          mode: 'retry',
          lastBand: this.lastBandByConv.get(conv.id),
          setLastBand: (band) => this.lastBandByConv.set(conv.id, band),
          signal,
          persist: ({ text, failed, route, latencyMs, usage }) =>
            this.appendAssistant(
              conv,
              agentId,
              userMessage,
              text,
              latencyMs,
              model.model,
              route,
              failed,
              usage,
              thinkingParts.join(''),
            ),
          scheduleShortTerm: (result) =>
            this.shortTerm.scheduleConsolidation(result.conversation, emit, runId),
        },
      )
    } finally {
      this.endAbort(conv.id, signal)
      clearTelemetry?.()
    }
  }

  private async resolveAgentModel(preferredAgentId: string, workMode: 'office' | 'code' | 'custom') {
    let agentId = preferredAgentId || MAIN_AGENT_ID
    if (workMode === 'code') {
      try {
        await this.agents.get(CODER_AGENT_ID)
        agentId = CODER_AGENT_ID
      } catch {
        // 无内置 coder 时沿用会话 Agent
      }
    }

    let agent = await this.agents.get(agentId)
    if (!agent.enabled) throw new ValidationException(`Agent「${agent.name}」已停用`, [])

    // 编程档常强制切到 coder；用户往往只给主对话绑了模型 → 回退继承
    let modelId = agent.modelId?.trim() ?? ''
    if (!modelId) {
      const fallbackIds = [preferredAgentId, MAIN_AGENT_ID].filter(
        (id, i, arr) => Boolean(id) && id !== agentId && arr.indexOf(id) === i,
      )
      for (const fid of fallbackIds) {
        try {
          const fb = await this.agents.get(fid)
          if (fb.modelId?.trim()) {
            modelId = fb.modelId.trim()
            agent = { ...agent, modelId }
            break
          }
        } catch {
          // 忽略缺失的回退 Agent
        }
      }
    }
    if (!modelId) {
      throw new ValidationException(
        workMode === 'code'
          ? `Agent「${agent.name}」未绑定模型。请在 Agents 里给「${agent.name}」或主对话选用模型`
          : `Agent「${agent.name}」未绑定模型，请先在 Agents 中选用模型`,
        [],
      )
    }

    const model = await this.models.get(modelId)
    if (!model.enabled) throw new ValidationException(`模型「${model.name}」已停用`, [])
    if (!model.baseUrl?.trim()) throw new ValidationException('模型 Base URL 为空', [])
    if (!model.model?.trim()) throw new ValidationException('模型 ID 为空', [])
    return { agentId, agent, model }
  }

  onAppReady(): void {
    console.log('ChatService onAppReady')
    this.toolIndex.warmupInBackground()
  }

  async refreshToolIndex(): Promise<void> {
    await this.toolIndex.refreshToolIndex()
  }

  private async persistAssistant(
    conv: Conversation,
    agentId: string,
    userMessage: ChatMessage,
    text: string,
    latencyMs: number,
    modelId: string,
    route: RouteDecision | undefined,
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
    route: RouteDecision | undefined,
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
