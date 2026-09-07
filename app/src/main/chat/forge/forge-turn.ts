import type { ForgeConfig, TraceEvent } from '@chatvein/common'
import {
  DEFAULT_BUDGET,
  DEFAULT_EXEC_ALLOWLIST,
  DEFAULT_TRUNCATION,
} from '@chatvein/common'
import { createHarness } from '@chatvein/core'
import { emitTelemetry } from '@chatvein/observability'
import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { AgentConfig } from '../../agent/agent.types'
import type { ModelConfig } from '../../model/model.types'
import type { SettingsService } from '../../settings/settings.service'
import type { ChatMessage, ChatSendResult, ChatStreamEvent, Conversation } from '../chat.types'
import { formatAgentError, friendlyReplyFailure } from '../turn/office-helpers'

export type ForgePersistFn = (text: string, failed: boolean) => Promise<ChatSendResult>

export interface RunForgeCodingTurnDeps {
  settings: SettingsService
}

export interface RunForgeCodingTurnArgs {
  conv: Conversation
  agentId: string
  agent: AgentConfig
  model: ModelConfig
  userMessage: ChatMessage
  content: string
  runId: string
  emit: (evt: ChatStreamEvent) => void
  thinkingParts: string[]
  persist: ForgePersistFn
}

/**
 * 编程开发档：经 `@chatvein/core` Harness → `@chatvein/orchestrator` StateGraph。
 * 用户消息写成需求文档；沙箱工作区指向 `devProjectRoot`（真实项目）。
 */
export async function runForgeCodingTurn(
  deps: RunForgeCodingTurnDeps,
  args: RunForgeCodingTurnArgs,
): Promise<ChatSendResult> {
  const { conv, model, content, runId, emit, persist } = args
  const started = Date.now()

  const settings = await deps.settings.get()
  const projectRoot = settings.devProjectRoot?.trim() ?? ''
  if (!projectRoot || !isAbsolute(projectRoot)) {
    emit({ type: 'thinking_done', runId, conversationId: conv.id })
    return persist(
      friendlyReplyFailure(
        '编程开发需要先选择项目根目录（页面上方「选择项目」），Forge 才会在真实仓库内编排实现与验证。',
      ),
      true,
    )
  }

  emit({
    type: 'thinking_delta',
    runId,
    conversationId: conv.id,
    delta: `Forge 编排：项目根 ${projectRoot}\n`,
  })

  const runsRoot = join(conv.sandboxPath, 'forge')
  await fs.mkdir(runsRoot, { recursive: true })
  await fs.mkdir(join(conv.workspacePath, 'memory'), { recursive: true })
  const requirementPath = join(conv.workspacePath, 'memory', `requirement-${runId}.md`)
  const requirementBody = [
    '# 用户需求',
    '',
    content,
    '',
    '---',
    '',
    `项目根目录：${projectRoot}`,
    '请在该仓库内完成实现；改动应可构建/测试验证。',
    '',
  ].join('\n')
  await fs.writeFile(requirementPath, requirementBody, 'utf8')

  let skipBuild = false
  try {
    await fs.access(join(projectRoot, 'package.json'))
  } catch {
    skipBuild = true
    emit({
      type: 'thinking_delta',
      runId,
      conversationId: conv.id,
      delta: '未找到 package.json → skipBuild（跳过 npm build/test）\n',
    })
  }

  const forgeConfig = forgeConfigFromModel(model, runsRoot)
  const harness = createHarness({ config: forgeConfig, runsRoot })
  const forgeRunId = `chat-${runId.slice(0, 8)}`

  emit({
    type: 'thinking_delta',
    runId,
    conversationId: conv.id,
    delta: `启动 orchestrator runId=${forgeRunId}\n`,
  })

  try {
    const handle = await harness.start({
      requirementPath,
      runId: forgeRunId,
      workspacePath: projectRoot,
      skipBuild,
      compileStrategy: 'sections',
    })

    const unsub = handle.onEvent((evt: TraceEvent) => {
      if (evt.runId !== forgeRunId && evt.runId !== handle.runId) return
      const line = formatForgeTraceDelta(evt)
      if (!line) return
      emit({
        type: 'thinking_delta',
        runId,
        conversationId: conv.id,
        delta: line,
      })
    })

    let report: Awaited<typeof handle.done>
    try {
      report = await handle.done
    } finally {
      unsub()
    }

    emit({ type: 'thinking_done', runId, conversationId: conv.id })

    const summary =
      report.summary?.trim() ||
      (report.status === 'done' ? 'Forge 运行完成（无汇总文本）。' : 'Forge 运行已中止。')
    const failed = report.status === 'aborted' || report.failedTasks.length > 0
    const body = [
      summary,
      report.failedTasks.length ? `\n未完成任务：${report.failedTasks.join(', ')}` : '',
      `\n\n— Forge ${report.status} · run \`${report.runId}\``,
    ].join('')

    emitTelemetry('trace:forge:response', {
      runId: report.runId,
      status: report.status,
      failedTasks: report.failedTasks,
      latencyMs: Date.now() - started,
      projectRoot,
    })

    return persist(body, failed)
  } catch (err) {
    emit({ type: 'thinking_done', runId, conversationId: conv.id })
    return persist(friendlyReplyFailure(formatAgentError(err)), true)
  }
}

/** 用当前 Agent 绑定模型填满 strong/medium/weak（一期同端点） */
export function forgeConfigFromModel(model: ModelConfig, runsRoot: string): ForgeConfig {
  const endpoint = {
    id: model.id,
    baseUrl: model.baseUrl.trim(),
    apiKey: model.apiKey || undefined,
    model: model.model.trim(),
    temperature: model.temperature,
    maxTokens: model.maxTokens > 0 ? model.maxTokens : undefined,
  }
  return {
    models: {
      strong: [endpoint],
      medium: [endpoint],
      weak: [endpoint],
    },
    budget: { ...DEFAULT_BUDGET },
    parallelism: 1,
    runsRoot,
    sandbox: { provider: 'local' },
    retry: { maxAttempts: 3 },
    tools: {
      execAllowlist: [...DEFAULT_EXEC_ALLOWLIST],
      truncation: { ...DEFAULT_TRUNCATION },
    },
  }
}

export function formatForgeTraceDelta(evt: TraceEvent): string {
  const name = evt.name ? ` ${evt.name}` : ''
  switch (evt.kind) {
    case 'run_start':
      return `▸ run_start${name}\n`
    case 'run_end':
      return `▸ run_end${name}${evt.payload?.status ? ` status=${evt.payload.status}` : ''}\n`
    case 'node_enter':
      return `→ ${evt.name ?? 'node'}\n`
    case 'node_exit': {
      const extra =
        evt.payload && typeof evt.payload === 'object' ? summarizeForgePayload(evt.payload) : ''
      return `← ${evt.name ?? 'node'}${extra}\n`
    }
    case 'tool_call':
      return `  ⚙ tool${name}${evt.payload?.error ? ` 失败：${evt.payload.error}` : ''}\n`
    case 'model_call':
      return `  模型${name}\n`
    case 'verify':
      return `  ✓ verify${evt.error ? ` 失败：${evt.error}` : ''}\n`
    case 'budget':
      return `  ⚠ budget${name}${evt.error ? `：${evt.error}` : ''}\n`
    case 'error':
      return `  ✕ error${name}${evt.error ? `：${evt.error}` : ''}\n`
    default:
      return ''
  }
}

export function summarizeForgePayload(payload: Record<string, unknown>): string {
  if (typeof payload.taskCount === 'number') return ` tasks=${payload.taskCount}`
  if (typeof payload.title === 'string') return ` ${payload.title.slice(0, 60)}`
  if (typeof payload.taskId === 'string') return ` task=${payload.taskId}`
  if (payload.noMoreTasks) return '（无更多任务）'
  if (typeof payload.summary === 'string') return ` ${String(payload.summary).slice(0, 80)}`
  return ''
}
