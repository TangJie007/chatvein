import {
  createReactChatAgent,
  streamReactChatAgent,
  seedFilesFromDisk,
  flushFilesToDisk,
  type WorkspaceCheckpointer,
} from '@chatvein/agents'
import type { ComplexityBand, RouteDecision } from '@chatvein/common'
import type { ShortTermPlan } from '@chatvein/memory'
import { emitTelemetry } from '@chatvein/observability'
import { summarizeToolsForDebug } from '@chatvein/tools'
import type { BaseMessage } from '@langchain/core/messages'
import { promises as fs } from 'node:fs'
import type { AgentConfig } from '../../agent/agent.types'
import type { ModelConfig } from '../../model/model.types'
import type {
  ChatSendResult,
  ChatStreamEvent,
  Conversation,
  TokenUsage,
} from '../chat.types'
import { CODER_AGENT_ID } from '../constants'
import {
  artifactsFromReactMessages,
  artifactsFromWorkspaceDiff,
  listWorkspaceFiles,
  mergeArtifacts,
  snapshotWorkspaceMtimes,
} from '../artifacts/workspace-artifacts'
import { formatShortTermThinking, shortTermDebugInfo } from '../memory/short-term'
import { conversationOutputPath } from '../session/session-paths'
import type { ToolIndexService } from '../tools/tool-index.service'
import type { ChatLlmHelper } from './llm'
import {
  formatAgentError,
  formatPolicyApply,
  formatRouteThinking,
  friendlyReplyFailure,
  localReplyForRoute,
  systemPromptForRoute,
  temperatureForTier,
  withCodingContext,
} from './office-helpers'

export {
  formatAgentError,
  formatPolicyApply,
  formatRouteThinking,
  friendlyReplyFailure,
  localReplyForRoute,
  systemPromptForRoute,
  temperatureForTier,
  truncateTitle,
  withCodingContext,
  formatToolSelectorLabel,
} from './office-helpers'

export type OfficePersistFn = (args: {
  text: string
  failed: boolean
  route: RouteDecision | undefined
  latencyMs: number
  usage?: TokenUsage
}) => Promise<ChatSendResult>

export interface RunOfficeReactTurnDeps {
  llm: ChatLlmHelper
  toolIndex: ToolIndexService
  getCheckpointer: (workspacePath: string) => WorkspaceCheckpointer
}

export interface RunOfficeReactTurnArgs {
  conv: Conversation
  agent: AgentConfig
  model: ModelConfig
  content: string
  history: Array<{ role: 'user' | 'assistant' | 'system'; content: string }>
  shortTermPlan: ShortTermPlan
  runId: string
  emit: (evt: ChatStreamEvent) => void
  mode: 'send' | 'retry'
  lastBand: ComplexityBand | undefined
  setLastBand: (band: ComplexityBand) => void
  persist: OfficePersistFn
  scheduleShortTerm: (result: ChatSendResult) => void
  signal?: AbortSignal
}

/**
 * L1/L2 →（可选本地短路）→ ReAct。send / retry 共用，差异由 `mode` 控制。
 */
export async function runOfficeReactTurn(
  deps: RunOfficeReactTurnDeps,
  args: RunOfficeReactTurnArgs,
): Promise<ChatSendResult> {
  const {
    conv,
    agent,
    model,
    content,
    history,
    shortTermPlan,
    runId,
    emit,
    mode,
    persist,
    scheduleShortTerm,
  } = args

  const router = await deps.llm.routerWithL2(model)
  const route = await router.route({
    text: content,
    session: {
      turnIndex: history.filter((m) => m.role === 'user').length,
      lastBand: args.lastBand,
      lastAssistantHadTools: false,
      recentFailure: mode === 'retry',
      activeMode: 'chat',
    },
  })
  args.setLastBand(route.band)

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
    delta: formatShortTermThinking(shortTermPlan),
  })

  if (mode === 'send') {
    if (route.terminal?.kind === 'slash') {
      const cmd = String(route.terminal.payload?.slashCmd ?? '')
      const text = `已识别命令 /${cmd}（本地处理占位；尚未绑定具体动作）。`
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return persist({ text, failed: false, route, latencyMs: 0 })
    }
    if (route.terminal?.kind === 'empty') {
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return persist({ text: '（空消息，已忽略）', failed: false, route, latencyMs: 0 })
    }
  }

  const maxSteps = route.policy.maxSteps
  const toolPolicy = route.policy.tools

  if (mode === 'send') {
    emit({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: formatPolicyApply(route),
    })
  }

  const allowLocalShortCircuit =
    maxSteps <= 0 &&
    (route.reasons.includes('greeting_only') || route.reasons.includes('self_intro'))

  if (allowLocalShortCircuit) {
    const text = localReplyForRoute(route, content)
    if (mode === 'send') {
      emit({
        type: 'thinking_delta',
        runId,
        conversationId: conv.id,
        delta: `执行：maxSteps=${maxSteps} → 本地短路，跳过 LLM\n`,
      })
      emitTelemetry('trace:react:skipped', {
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
    }
    emit({ type: 'thinking_done', runId, conversationId: conv.id })
    return persist({ text, failed: false, route, latencyMs: 0 })
  }

  const recursionLimit = Math.max(1, maxSteps)
  // 普通对话的产物根：会话工作区下的 output/。对话产出的文件都落在这里，
  // 文件工具 jail 与产物扫描均以它为根（编程开发档仍直接操作真实项目根）。
  const isCodingAgent = agent.id === CODER_AGENT_ID
  const artifactRoot = isCodingAgent ? conv.workspacePath : conversationOutputPath(conv.workspacePath)
  if (!isCodingAgent) await fs.mkdir(artifactRoot, { recursive: true })

  const { toolRoot, projectRoot } = await deps.toolIndex.resolveToolRoot(agent, artifactRoot)
  if (mode === 'send' && projectRoot) {
    emit({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: `编程开发模式：项目根 ${projectRoot}\n`,
    })
  }

  const systemPrompt = withCodingContext(systemPromptForRoute(agent.systemPrompt, route), projectRoot)
  const llm = deps.llm.createDebugAwareLlm(model, {
    temperature: temperatureForTier(route.policy.modelTier, model.temperature),
    maxTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
  })

  const toolQuery = route.rewrittenQuery?.trim() || content
  if (mode === 'send' && route.rewrittenQuery?.trim()) {
    emit({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: `工具检索 query：${toolQuery.slice(0, 120)}${toolQuery.length > 120 ? '…' : ''}\n`,
    })
  }
  const boundTools = await deps.toolIndex.resolveBoundTools(
    agent,
    toolPolicy,
    toolRoot,
    toolQuery,
    model,
  )
  if (mode === 'send' && boundTools.length > 0) {
    emit({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: `绑定工具：${boundTools.map((t) => t.name).join(', ')}\n`,
    })
  }

  const checkpointer = deps.getCheckpointer(conv.workspacePath)
  await checkpointer.deleteThread(conv.id)
  const enableFilesystem = toolPolicy !== 'none' && toolPolicy !== 'unknown'
  const seedFiles = enableFilesystem ? await seedFilesFromDisk(toolRoot) : undefined
  const reactAgent = createReactChatAgent({
    model: llm,
    tools: boundTools,
    systemPrompt,
    name: agent.name,
    checkpointer,
    filesystem: enableFilesystem,
  })

  const started = Date.now()
  const beforeSnap = await snapshotWorkspaceMtimes(artifactRoot)
  try {
    if (mode === 'send') {
      emitTelemetry('trace:react:request', {
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
        toolsBound: [
          ...boundTools.map((t) => t.name),
          ...(enableFilesystem
            ? ['ls', 'read_file', 'write_file', 'edit_file', 'glob', 'grep']
            : []),
        ],
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
        shortTerm: shortTermDebugInfo(shortTermPlan),
      })
    }

    // 思考流：是否已插入「模型思考」分隔标题（避免长推理中重复打印）
    let reasoningHeaderEmitted = false
    const result = await streamReactChatAgent(
      reactAgent,
      {
        message: content,
        history,
        recursionLimit,
        threadId: conv.id,
        signal: args.signal,
        ...(seedFiles ? { files: seedFiles } : {}),
      },
      {
        onReasoning: (delta) => {
          if (!reasoningHeaderEmitted) {
            emit({
              type: 'thinking_delta',
              runId,
              conversationId: conv.id,
              delta: '\n模型思考：\n',
            })
            reasoningHeaderEmitted = true
          }
          emit({ type: 'thinking_delta', runId, conversationId: conv.id, delta })
        },
        onToolCallStart: ({ name }) => {
          emit({
            type: 'thinking_delta',
            runId,
            conversationId: conv.id,
            delta: `\n调用工具：${name}\n`,
          })
        },
      },
    )
    if (enableFilesystem) await flushFilesToDisk(toolRoot, result.files)
    const text = result.content.trim()

    if (mode === 'send') {
      emitTelemetry('trace:react:response', {
        content: result.content,
        messageCount: result.messages.length,
        messages: result.messages,
        usage: result.usage,
        latencyMs: Date.now() - started,
      })
    }

    await emitRunArtifacts(emit, runId, conv, artifactRoot, beforeSnap, result.messages)
    emit({ type: 'thinking_done', runId, conversationId: conv.id })

    if (!text) {
      return persist({
        text: friendlyReplyFailure('模型返回空内容'),
        failed: true,
        route,
        latencyMs: Date.now() - started,
      })
    }

    const ok = await persist({
      text,
      failed: false,
      route,
      latencyMs: Date.now() - started,
      usage: result.usage,
    })
    scheduleShortTerm(ok)
    return ok
  } catch (err) {
    emit({ type: 'thinking_done', runId, conversationId: conv.id })
    return persist({
      text: friendlyReplyFailure(formatAgentError(err)),
      failed: true,
      route,
      latencyMs: Date.now() - started,
    })
  }
}

async function emitRunArtifacts(
  emit: ((evt: ChatStreamEvent) => void) | undefined,
  runId: string,
  conv: Conversation,
  artifactRoot: string,
  beforeSnap: Map<string, number>,
  messages: BaseMessage[],
): Promise<void> {
  if (!emit) return
  try {
    const after = await listWorkspaceFiles(artifactRoot)
    const items = mergeArtifacts(
      artifactsFromWorkspaceDiff(beforeSnap, after),
      artifactsFromReactMessages(messages, artifactRoot),
    )
    if (items.length === 0) return
    emit({ type: 'artifacts', runId, conversationId: conv.id, items })
  } catch (err) {
    console.warn('[ChatService] emitRunArtifacts failed', err)
  }
}
