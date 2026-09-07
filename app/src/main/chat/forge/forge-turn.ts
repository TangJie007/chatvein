import type { ForgeConfig, TraceEvent } from '@chatvein/common'
import {
  DEFAULT_BUDGET,
  DEFAULT_EXEC_ALLOWLIST,
  DEFAULT_TRUNCATION,
} from '@chatvein/common'
import { extractFacts, isGreetingOnly, ZH_DICT } from '@chatvein/agents'
import { createHarness } from '@chatvein/core'
import { emitTelemetry } from '@chatvein/observability'
import { promises as fs } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { AgentConfig } from '../../agent/agent.types'
import type { ModelConfig } from '../../model/model.types'
import type { SettingsService } from '../../settings/settings.service'
import type {
  ChatAttachment,
  ChatMessage,
  ChatSendResult,
  ChatStreamEvent,
  Conversation,
} from '../chat.types'
import {
  artifactsFromWorkspaceDiff,
  listWorkspaceFiles,
  mergeArtifacts,
  snapshotWorkspaceMtimes,
} from '../artifacts/workspace-artifacts'
import { formatAgentError, friendlyReplyFailure } from '../turn/office-helpers'
import { writeForgeRequirementFile } from './forge-requirement'

export type ForgePersistFn = (text: string, failed: boolean) => Promise<ChatSendResult>

export interface RunForgeCodingTurnDeps {
  settings: SettingsService
  /** 弱模端点（diagnose/summarize）；缺省与主模型相同 */
  weakModel?: ModelConfig
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
  signal?: AbortSignal
  /** 显式续跑上次 Forge（也可由文案「继续上次」触发） */
  resumeForge?: boolean
  /** 对话框上传的需求文档（本机路径；写入会话 memory，不进项目仓） */
  attachments?: ChatAttachment[]
}

const RESUME_RE = /^(继续(上次|上一次|forge|运行)?|resume(\s+forge)?|续跑)$/i
const CODING_INTENT_RE =
  /实现|添加|新增|修复|重构|改写|编写|写一|写个|创建|删除|优化|升级|迁移|接入|集成|bug|fix|implement|refactor|add\s|create\s|update\s|patch/i

/**
 * 编程开发档：经 `@chatvein/core` Harness → `@chatvein/orchestrator` StateGraph。
 * 用户消息写成需求文档；沙箱工作区指向 `devProjectRoot`（真实项目）。
 */
export async function runForgeCodingTurn(
  deps: RunForgeCodingTurnDeps,
  args: RunForgeCodingTurnArgs,
): Promise<ChatSendResult> {
  const { conv, model, content, runId, emit, persist, signal } = args
  const started = Date.now()

  // 寒暄短路：不进 Forge
  try {
    const facts = extractFacts(content, {
      turnIndex: 0,
      lastAssistantHadTools: false,
      recentFailure: false,
      activeMode: 'forge',
    })
    if (facts.hitGreetingOnly || isGreetingOnly(content, ZH_DICT)) {
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return persist(
        '你好。当前是「编程开发」档：选好项目根后，描述要实现/修复的需求即可启动 Forge；也可以点「继续上次」续跑未完成的编排。',
        false,
      )
    }
  } catch {
    // 字典加载失败时不短路
  }

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

  const runsRoot = join(conv.sandboxPath, 'forge')
  await fs.mkdir(runsRoot, { recursive: true })
  await fs.mkdir(join(conv.workspacePath, 'memory'), { recursive: true })

  const wantResume = args.resumeForge || RESUME_RE.test(content.trim())
  if (wantResume) {
    return resumeForgeTurn(deps, args, { projectRoot, runsRoot, started })
  }

  // 轻量路径：短句且无编码意图、且无上传需求文档 → 不直接改仓库
  const trimmed = content.trim()
  const hasReqAttach = (args.attachments ?? args.userMessage.attachments ?? []).some(
    (a) => a.path?.trim(),
  )
  if (!hasReqAttach && trimmed.length < 12 && !CODING_INTENT_RE.test(trimmed)) {
    emit({ type: 'thinking_done', runId, conversationId: conv.id })
    return persist(
      '当前是编程开发档。请用一两句话说明要在仓库里**实现 / 修复 / 重构**什么，或上传需求文档后再发送（可点「继续上次」续跑）。',
      false,
    )
  }

  emit({
    type: 'thinking_delta',
    runId,
    conversationId: conv.id,
    delta: `Forge 编排：项目根 ${projectRoot}\n`,
  })

  const requirementPath = join(conv.workspacePath, 'memory', `requirement-${runId}.md`)
  const attachments = args.attachments ?? args.userMessage.attachments
  let reqMeta: { source: string; attachmentNames: string[] }
  try {
    reqMeta = await writeForgeRequirementFile({
      destPath: requirementPath,
      projectRoot,
      userText: content,
      attachments,
    })
  } catch (err) {
    emit({ type: 'thinking_done', runId, conversationId: conv.id })
    return persist(friendlyReplyFailure((err as Error).message), true)
  }

  const { skipBuild, buildCommand, testCommand } = await resolveVerifyCommands(settings, projectRoot, emit, runId, conv.id)

  const forgeConfig = forgeConfigFromModel(model, runsRoot, deps.weakModel)
  const harness = createHarness({ config: forgeConfig, runsRoot })
  const forgeRunId = `chat-${runId.slice(0, 8)}`

  const srcHint =
    reqMeta.source === 'chat'
      ? '来源=对话框描述'
      : reqMeta.source === 'upload'
        ? `来源=上传文档（${reqMeta.attachmentNames.join(', ')}）`
        : `来源=上传文档+说明（${reqMeta.attachmentNames.join(', ')}）`
  emit({
    type: 'thinking_delta',
    runId,
    conversationId: conv.id,
    delta: `需求已写入会话 memory（不进项目仓）· ${srcHint}\n启动 orchestrator runId=${forgeRunId}${skipBuild ? ' · skipBuild' : ''}${buildCommand ? ` · build=${buildCommand.join(' ')}` : ''}${testCommand ? ` · test=${testCommand.join(' ')}` : ''}\n`,
  })

  const beforeSnap = await snapshotWorkspaceMtimes(projectRoot)

  try {
    if (signal?.aborted) {
      emit({ type: 'thinking_done', runId, conversationId: conv.id })
      return persist(friendlyReplyFailure('已取消'), true)
    }

    const handle = await harness.start({
      requirementPath,
      runId: forgeRunId,
      workspacePath: projectRoot,
      skipBuild,
      buildCommand,
      testCommand,
      compileStrategy: 'sections',
      signal,
    })

    await writeLastForgeRun(runsRoot, {
      runId: handle.runId,
      projectRoot,
      requirementPath,
      updatedAt: Date.now(),
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

    await emitForgeArtifacts(emit, runId, conv.id, projectRoot, beforeSnap, report.runDir)

    emit({ type: 'thinking_done', runId, conversationId: conv.id })

    const cancelled = signal?.aborted || /取消/.test(report.summary ?? '')
    const summary =
      report.summary?.trim() ||
      (report.status === 'done' ? 'Forge 运行完成（无汇总文本）。' : 'Forge 运行已中止。')
    const failed = report.status === 'aborted' || report.failedTasks.length > 0 || cancelled
    const body = [
      summary,
      report.failedTasks.length ? `\n未完成任务：${report.failedTasks.join(', ')}` : '',
      `\n\n— Forge ${report.status} · run \`${report.runId}\``,
      failed && !cancelled ? '\n可发送「继续上次」或点击续跑，从 checkpoint 恢复。' : '',
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
    if (signal?.aborted || isAbortError(err)) {
      return persist(friendlyReplyFailure('已取消'), true)
    }
    return persist(friendlyReplyFailure(formatAgentError(err)), true)
  }
}

async function resumeForgeTurn(
  deps: RunForgeCodingTurnDeps,
  args: RunForgeCodingTurnArgs,
  ctx: { projectRoot: string; runsRoot: string; started: number },
): Promise<ChatSendResult> {
  const { conv, model, runId, emit, persist, signal } = args
  const last = await readLastForgeRun(ctx.runsRoot)
  if (!last?.runId) {
    emit({ type: 'thinking_done', runId, conversationId: conv.id })
    return persist(friendlyReplyFailure('没有可续跑的 Forge 记录。请先发送一条编码需求。'), true)
  }

  emit({
    type: 'thinking_delta',
    runId,
    conversationId: conv.id,
    delta: `续跑 Forge runId=${last.runId} · ${ctx.projectRoot}\n`,
  })

  const beforeSnap = await snapshotWorkspaceMtimes(ctx.projectRoot)
  const forgeConfig = forgeConfigFromModel(model, ctx.runsRoot, deps.weakModel)
  const harness = createHarness({ config: forgeConfig, runsRoot: ctx.runsRoot })

  try {
    const handle = await harness.resume(last.runId, signal)
    const unsub = handle.onEvent((evt: TraceEvent) => {
      if (evt.runId !== last.runId && evt.runId !== handle.runId) return
      const line = formatForgeTraceDelta(evt)
      if (!line) return
      emit({ type: 'thinking_delta', runId, conversationId: conv.id, delta: line })
    })

    let report: Awaited<typeof handle.done>
    try {
      report = await handle.done
    } finally {
      unsub()
    }

    await writeLastForgeRun(ctx.runsRoot, {
      runId: handle.runId,
      projectRoot: ctx.projectRoot,
      requirementPath: last.requirementPath,
      updatedAt: Date.now(),
    })

    await emitForgeArtifacts(emit, runId, conv.id, ctx.projectRoot, beforeSnap, report.runDir)
    emit({ type: 'thinking_done', runId, conversationId: conv.id })

    const failed = report.status === 'aborted' || report.failedTasks.length > 0
    const body = [
      report.summary?.trim() || (failed ? '续跑已中止。' : '续跑完成。'),
      report.failedTasks.length ? `\n未完成任务：${report.failedTasks.join(', ')}` : '',
      `\n\n— Forge resume ${report.status} · run \`${report.runId}\``,
    ].join('')

    emitTelemetry('trace:forge:resume', {
      runId: report.runId,
      status: report.status,
      latencyMs: Date.now() - ctx.started,
    })

    return persist(body, failed)
  } catch (err) {
    emit({ type: 'thinking_done', runId, conversationId: conv.id })
    if (signal?.aborted || isAbortError(err)) {
      return persist(friendlyReplyFailure('已取消'), true)
    }
    return persist(friendlyReplyFailure(formatAgentError(err)), true)
  }
}

async function resolveVerifyCommands(
  settings: Awaited<ReturnType<SettingsService['get']>>,
  projectRoot: string,
  emit: (evt: ChatStreamEvent) => void,
  runId: string,
  conversationId: string,
): Promise<{ skipBuild: boolean; buildCommand?: string[]; testCommand?: string[] }> {
  let skipBuild = settings.forgeSkipBuild === true
  const buildCommand = parseArgv(settings.forgeBuildCommand)
  const testCommand = parseArgv(settings.forgeTestCommand)

  if (!skipBuild) {
    try {
      await fs.access(join(projectRoot, 'package.json'))
    } catch {
      skipBuild = true
      emit({
        type: 'thinking_delta',
        runId,
        conversationId,
        delta: '未找到 package.json → skipBuild（跳过默认 npm build/test）\n',
      })
    }
  } else {
    emit({
      type: 'thinking_delta',
      runId,
      conversationId,
      delta: '设置项 forgeSkipBuild=true → 跳过构建\n',
    })
  }

  return { skipBuild, buildCommand, testCommand }
}

function parseArgv(raw: string | undefined): string[] | undefined {
  const s = raw?.trim()
  if (!s) return undefined
  const out: string[] = []
  const re = /"([^"]*)"|(\S+)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(s))) out.push(m[1] ?? m[2]!)
  return out.length ? out : undefined
}

async function emitForgeArtifacts(
  emit: (evt: ChatStreamEvent) => void,
  runId: string,
  conversationId: string,
  projectRoot: string,
  beforeSnap: Map<string, number>,
  runDir: string,
): Promise<void> {
  try {
    const after = await listWorkspaceFiles(projectRoot)
    const items = mergeArtifacts(artifactsFromWorkspaceDiff(beforeSnap, after), [
      {
        id: `forge-run:${runDir}`,
        title: 'Forge run 目录',
        kind: 'run',
        detail: runDir,
        absPath: runDir,
      },
    ])
    if (items.length) {
      emit({ type: 'artifacts', runId, conversationId, items })
    }
  } catch {
    // 产物扫描失败不影响主回复
  }
}

interface LastForgeRun {
  runId: string
  projectRoot: string
  requirementPath?: string
  updatedAt: number
}

function lastRunPath(runsRoot: string) {
  return join(runsRoot, 'last-run.json')
}

export async function writeLastForgeRun(runsRoot: string, meta: LastForgeRun): Promise<void> {
  await fs.mkdir(runsRoot, { recursive: true })
  await fs.writeFile(lastRunPath(runsRoot), JSON.stringify(meta, null, 2), 'utf8')
}

export async function readLastForgeRun(runsRoot: string): Promise<LastForgeRun | null> {
  try {
    return JSON.parse(await fs.readFile(lastRunPath(runsRoot), 'utf8')) as LastForgeRun
  } catch {
    return null
  }
}

/** 用当前 Agent 绑定模型填满档位；弱模优先用于 diagnose/summarize */
export function forgeConfigFromModel(
  model: ModelConfig,
  runsRoot: string,
  weakModel?: ModelConfig,
): ForgeConfig {
  const toEndpoint = (m: ModelConfig) => ({
    id: m.id,
    baseUrl: m.baseUrl.trim(),
    apiKey: m.apiKey || undefined,
    model: m.model.trim(),
    temperature: m.temperature,
    maxTokens: m.maxTokens > 0 ? m.maxTokens : undefined,
  })
  const strong = toEndpoint(model)
  const weak = weakModel ? toEndpoint(weakModel) : strong
  return {
    models: {
      strong: [strong],
      medium: [strong],
      weak: [weak],
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
      return `▸ run_start${name}${evt.payload?.resume ? '（续跑）' : ''}\n`
    case 'run_end': {
      const st = evt.payload?.status ? ` status=${evt.payload.status}` : ''
      const steps = typeof evt.payload?.steps === 'number' ? ` steps=${evt.payload.steps}` : ''
      const tok =
        typeof evt.payload?.totalTokens === 'number' ? ` tokens=${evt.payload.totalTokens}` : ''
      return `▸ run_end${name}${st}${steps}${tok}\n`
    }
    case 'node_enter':
      return `→ ${evt.name ?? 'node'}${summarizeForgePayload(evt.payload as Record<string, unknown> | undefined)}\n`
    case 'node_exit': {
      const extra =
        evt.payload && typeof evt.payload === 'object'
          ? summarizeForgePayload(evt.payload as Record<string, unknown>)
          : ''
      return `← ${evt.name ?? 'node'}${extra}\n`
    }
    case 'tool_call': {
      const err = evt.payload?.error || evt.error
      const dur = typeof evt.durationMs === 'number' ? ` ${evt.durationMs}ms` : ''
      return `  ⚙ ${evt.name ?? 'tool'}${dur}${err ? ` 失败：${err}` : ''}\n`
    }
    case 'model_call': {
      const node = evt.payload?.node ? ` ${evt.payload.node}` : ''
      const tok =
        typeof evt.payload?.totalTokens === 'number' ? ` tokens=${evt.payload.totalTokens}` : ''
      return `  模型${name}${node}${tok}\n`
    }
    case 'verify': {
      const p = evt.payload as Record<string, unknown> | undefined
      const bits: string[] = []
      if (typeof p?.passed === 'boolean') bits.push(p.passed ? '通过' : '未通过')
      if (p?.buildStatus) bits.push(`build=${p.buildStatus}`)
      if (typeof p?.testPassed === 'number' || typeof p?.testFailed === 'number') {
        bits.push(`tests ${p.testPassed ?? '?'}/${p.testFailed ?? '?'}`)
      }
      if (Array.isArray(p?.failures) && p.failures.length) {
        bits.push(`失败例：${(p.failures as string[]).slice(0, 3).join(', ')}`)
      }
      return `  ✓ verify${bits.length ? ` ${bits.join(' · ')}` : ''}${evt.error ? ` 失败：${evt.error}` : ''}\n`
    }
    case 'budget':
      return `  ⚠ budget${name}${evt.error ? `：${evt.error}` : ''}\n`
    case 'error':
      return `  ✕ error${name}${evt.error ? `：${evt.error}` : ''}\n`
    default:
      return ''
  }
}

export function summarizeForgePayload(payload: Record<string, unknown> | undefined): string {
  if (!payload) return ''
  if (typeof payload.taskCount === 'number') return ` tasks=${payload.taskCount}`
  if (typeof payload.title === 'string') return ` ${payload.title.slice(0, 60)}`
  if (typeof payload.taskId === 'string') return ` task=${payload.taskId}`
  if (payload.noMoreTasks) return '（无更多任务）'
  if (typeof payload.summary === 'string') return ` ${String(payload.summary).slice(0, 80)}`
  if (typeof payload.rootCause === 'string') return ` ${String(payload.rootCause).slice(0, 80)}`
  return ''
}

function isAbortError(err: unknown): boolean {
  return err instanceof Error && (err.name === 'AbortError' || /abort|取消/i.test(err.message))
}
